import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Icon from '../../Icon';
import type { ChannelMessage, QuickReply } from '../../api/messaging';
import {
  byteLength,
  chatFileKind,
  checkChatFile,
  splitByBytes,
  TEXT_LIMIT_BYTES,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  type ChatFileKind,
} from '../../utils/chatLimits';
import EmojiPicker from './EmojiPicker';

// Карта (Leaflet, ~150 КБ) грузится, только когда открывают «Место на карте».
const LocationPicker = lazy(() => import('./LocationPicker'));

export interface ComposerEdit {
  messageId: string;
  text: string;
  /** true — неушедшее сообщение: исправленный текст уйдёт на его же месте. */
  retry: boolean;
}

const KIND_LABEL: Record<string, string> = { IMAGE: 'Фото', VIDEO: 'Видео', AUDIO: 'Голосовое', FILE: 'Файл', STICKER: 'Стикер', SHARE: 'Публикация', REEL: 'Reels', STORY: 'История', LOCATION: 'Место' };

/**
 * 21.11.2026 — поле ответа в стиле Instagram: смайлы слева, справа — голосовое,
 * файл, место и быстрые ответы, пока поле пустое; «Отправить», когда есть текст.
 * «/» в начале — список быстрых ответов (стрелки, Enter, Esc). Над полем —
 * «Ответ на …» при ответе цитатой и «Исправление …».
 *
 * Очищается сразу по нажатию «Отправить», как в мессенджере. Не дошло до
 * сервера — текст возвращается в поле, если там ещё не начато новое.
 * Пределы те же, что на сервере: байты текста, типы и размеры файлов.
 */
export default function ChatComposer({
  channel,
  disabledReason,
  edit,
  onCancelEdit,
  replyTo,
  onCancelReply,
  quickReplies,
  canManageQuickReplies,
  onManageQuickReplies,
  onTyping,
  onSendText,
  onSendFile,
  onSendVoice,
  onSendLocation,
}: {
  channel: string;
  disabledReason: string | null;
  edit: ComposerEdit | null;
  onCancelEdit: () => void;
  replyTo: ChannelMessage | null;
  onCancelReply: () => void;
  quickReplies: QuickReply[];
  canManageQuickReplies: boolean;
  onManageQuickReplies: () => void;
  onTyping: () => void;
  onSendText: (text: string, edit: ComposerEdit | null, replyTo: ChannelMessage | null) => Promise<boolean>;
  onSendFile: (file: File) => Promise<boolean>;
  onSendVoice: (blob: Blob) => Promise<boolean>;
  onSendLocation: (loc: { latitude: number; longitude: number; name?: string; address?: string }) => Promise<boolean>;
}) {
  const meta = channel === 'INSTAGRAM' || channel === 'WHATSAPP';
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  draftRef.current = draft;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [quickIdx, setQuickIdx] = useState(0);
  const [quickDismissed, setQuickDismissed] = useState(false);
  // Голосовое: idle → recording → preview
  const [rec, setRec] = useState<{ state: 'idle' | 'recording' | 'preview'; seconds: number; blob?: Blob; url?: string }>({ state: 'idle', seconds: 0 });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [busy, setBusy] = useState(false);
  // 09.11.2026 — выбранный файл сначала показывается (фото, видео, PDF), уходит по «Отправить».
  const [picked, setPicked] = useState<{ file: File; kind: ChatFileKind; url: string } | null>(null);
  const pickedUrlRef = useRef<string | null>(null);
  pickedUrlRef.current = picked?.url ?? null;
  const typingAtRef = useRef(0);

  useEffect(() => () => {
    if (pickedUrlRef.current) URL.revokeObjectURL(pickedUrlRef.current);
  }, []);

  useEffect(() => {
    if (edit) {
      setDraft(edit.text);
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }, [edit]);

  useEffect(() => {
    if (replyTo) requestAnimationFrame(() => taRef.current?.focus());
  }, [replyTo]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // Поле растёт вместе с текстом до 6 строк, дальше — прокрутка внутри.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft]);

  const limit = meta ? TEXT_LIMIT_BYTES[channel as 'INSTAGRAM' | 'WHATSAPP'] : 0;
  const bytes = meta ? byteLength(draft.trim()) : 0;
  const parts = useMemo(() => (meta && bytes > limit ? splitByBytes(draft, limit).length : 1), [meta, bytes, limit, draft]);

  // «/» в начале поля — быстрые ответы.
  const quickQuery = !quickDismissed && draft.startsWith('/') && !draft.includes('\n') ? draft.slice(1).trim().toLowerCase() : null;
  const quickMatches = useMemo(
    () =>
      quickQuery === null
        ? []
        : quickReplies.filter((q) => !quickQuery || q.title.toLowerCase().includes(quickQuery) || q.text.toLowerCase().includes(quickQuery)).slice(0, 8),
    [quickQuery, quickReplies],
  );
  const quickOpen = quickQuery !== null;
  useEffect(() => setQuickIdx(0), [quickQuery]);

  const applyQuick = (q: QuickReply) => {
    setDraft(q.text);
    setQuickDismissed(false);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(q.text.length, q.text.length);
      }
    });
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    if (!value.startsWith('/')) setQuickDismissed(false);
    // Клиент видит «печатает…», пока сотрудник набирает (не чаще раза в 3 с).
    if (meta && value.trim() && !value.startsWith('/') && Date.now() - typingAtRef.current > 3000) {
      typingAtRef.current = Date.now();
      onTyping();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = taRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    changeDraft(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const at = start + emoji.length;
      el.setSelectionRange(at, at);
    });
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || disabledReason) return;
    // Открыт список быстрых ответов — «Отправить» подставляет выбранный, а не шлёт «/…».
    if (quickOpen && quickMatches.length) return applyQuick(quickMatches[quickIdx] ?? quickMatches[0]);
    const editCtx = edit;
    const replyCtx = replyTo;
    setDraft('');
    setEmojiOpen(false);
    const ok = await onSendText(text, editCtx, replyCtx);
    if (!ok && !draftRef.current) setDraft(text);
  };

  const pickFile = (file: File | undefined) => {
    setFileError(null);
    if (!file || !meta) return;
    const err = checkChatFile(channel as 'INSTAGRAM' | 'WHATSAPP', file);
    if (err) return setFileError(err);
    discardFile();
    setPicked({ file, kind: chatFileKind(file)!, url: URL.createObjectURL(file) });
  };

  const discardFile = () => {
    if (pickedUrlRef.current) URL.revokeObjectURL(pickedUrlRef.current);
    setPicked(null);
  };

  const sendFile = async () => {
    if (!picked) return;
    setBusy(true);
    const ok = await onSendFile(picked.file);
    setBusy(false);
    if (ok) discardFile();
  };

  const startRecording = async () => {
    setFileError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return setFileError('Этот браузер не умеет записывать звук.');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setFileError('Нет доступа к микрофону — разрешите его в браузере.');
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported?.(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      if (blob.size > VOICE_MAX_BYTES) {
        setRec({ state: 'idle', seconds: 0 });
        return setFileError('Голосовое больше 10 МБ.');
      }
      setRec((r) => ({ state: 'preview', seconds: r.seconds, blob, url: URL.createObjectURL(blob) }));
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setRec({ state: 'recording', seconds: 0 });
    timerRef.current = setInterval(() => {
      setRec((r) => {
        const s = r.seconds + 1;
        if (s >= VOICE_MAX_SECONDS) recorderRef.current?.state === 'recording' && recorderRef.current.stop();
        return { ...r, seconds: s };
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const discardVoice = () => {
    if (rec.url) URL.revokeObjectURL(rec.url);
    setRec({ state: 'idle', seconds: 0 });
  };

  const sendVoice = async () => {
    if (!rec.blob) return;
    setBusy(true);
    const ok = await onSendVoice(rec.blob);
    setBusy(false);
    if (ok) discardVoice();
  };

  if (disabledReason) {
    return (
      <div className="dm-composer-disabled" data-testid="composer-disabled">
        <Icon name="info" size={16} />
        <span>{disabledReason}</span>
      </div>
    );
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const replyWhose = replyTo ? (replyTo.direction === 'INBOUND' ? 'клиенту' : replyTo.byAi ? 'на сообщение ИИ' : 'на своё сообщение') : '';
  const replyBody = replyTo
    ? replyTo.text || (replyTo.chatAttachments?.[0] ? KIND_LABEL[replyTo.chatAttachments[0].kind] ?? 'Вложение' : 'Сообщение')
    : '';

  return (
    <div className="dm-composer-wrap">
      {replyTo && !edit && (
        <div className="dm-composer-bar" data-testid="reply-bar">
          <div className="dm-composer-bar-body">
            <div className="dm-composer-bar-title">Ответ {replyWhose}</div>
            <div className="dm-composer-bar-text">{replyBody}</div>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Отменить ответ" data-testid="reply-cancel">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {edit && (
        <div className="dm-composer-bar edit" data-testid="edit-bar">
          <div className="dm-composer-bar-body">
            <div className="dm-composer-bar-title">
              <Icon name="edit" size={14} /> {edit.retry ? 'Исправление неушедшего сообщения' : 'Исправление'}
            </div>
            <div className="dm-composer-bar-text">{edit.retry ? 'Уйдёт на месте неушедшего.' : 'Отправленное в Instagram не меняется — исправление уйдёт новым сообщением.'}</div>
          </div>
          <button type="button" onClick={() => (onCancelEdit(), setDraft(''))} aria-label="Отменить исправление">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {fileError && <div className="dm-composer-error">{fileError}</div>}

      {quickOpen && (
        <div className="dm-quick" role="listbox" aria-label="Быстрые ответы" data-testid="quick-list">
          <div className="dm-quick-head">
            <span>Быстрые ответы</span>
            {canManageQuickReplies && (
              <button type="button" onClick={onManageQuickReplies} data-testid="quick-manage">
                Настроить
              </button>
            )}
          </div>
          {quickMatches.length === 0 ? (
            <div className="dm-quick-empty">
              {quickReplies.length === 0 ? 'Быстрых ответов пока нет.' : 'Ничего не найдено.'}
              {quickReplies.length === 0 && (canManageQuickReplies ? ' Нажмите «Настроить», чтобы добавить.' : ' Их добавляет руководство.')}
            </div>
          ) : (
            quickMatches.map((q, i) => (
              <button
                key={q.id}
                type="button"
                role="option"
                aria-selected={i === quickIdx}
                className={`dm-quick-item${i === quickIdx ? ' active' : ''}`}
                onMouseEnter={() => setQuickIdx(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyQuick(q)}
                data-testid="quick-item"
              >
                <span className="dm-quick-title">/{q.title}</span>
                <span className="dm-quick-text">{q.text}</span>
              </button>
            ))
          )}
        </div>
      )}

      {picked ? (
        <div className="dm-composer dm-file-preview" data-testid="file-preview">
          {picked.kind === 'IMAGE' && <img src={picked.url} alt="" className="dm-file-preview-media" />}
          {picked.kind === 'VIDEO' && <video src={picked.url} controls playsInline preload="metadata" className="dm-file-preview-media" data-testid="file-preview-video" />}
          {picked.kind === 'FILE' && <Icon name="picture_as_pdf" size={32} />}
          <div className="dm-file-preview-info">
            <div className="dm-file-preview-name">{picked.file.name}</div>
            <div className="dm-file-preview-size">
              {picked.kind === 'VIDEO' ? 'Видео' : picked.kind === 'IMAGE' ? 'Фото' : 'PDF'} · {(picked.file.size / 1048576).toFixed(picked.file.size < 1048576 ? 2 : 1)} МБ
            </div>
          </div>
          <button type="button" className="dm-btn-text muted" onClick={discardFile} disabled={busy}>
            Удалить
          </button>
          <button type="button" className="dm-btn-text" onClick={sendFile} disabled={busy} data-testid="file-send">
            {busy ? (picked.kind === 'VIDEO' ? 'Загружаем…' : 'Отправляем…') : 'Отправить'}
          </button>
        </div>
      ) : rec.state !== 'idle' ? (
        <div className="dm-composer dm-voice-bar" data-testid="voice-bar">
          {rec.state === 'recording' ? (
            <>
              <span className="dm-rec-dot" />
              <span className="dm-rec-time">{mmss(rec.seconds)} / 5:00</span>
              <button type="button" className="dm-btn-text" onClick={stopRecording} data-testid="voice-stop">
                Стоп
              </button>
            </>
          ) : (
            <>
              <audio src={rec.url} controls className="dm-audio" />
              <button type="button" className="dm-btn-text muted" onClick={discardVoice} disabled={busy}>
                Удалить
              </button>
              <button type="button" className="dm-btn-text" onClick={sendVoice} disabled={busy} data-testid="voice-send">
                {busy ? 'Отправляем…' : 'Отправить'}
              </button>
            </>
          )}
        </div>
      ) : (
        <form
          className="dm-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="dm-emoji-anchor">
            <button
              type="button"
              className={`dm-tool${emojiOpen ? ' on' : ''}`}
              title="Смайлы"
              aria-label="Смайлы"
              onClick={() => setEmojiOpen((v) => !v)}
              data-emoji-toggle
              data-testid="emoji-btn"
            >
              <Icon name="sentiment_satisfied" size={24} />
            </button>
            {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
          </div>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => changeDraft(e.target.value)}
            placeholder="Сообщение…"
            rows={1}
            maxLength={meta ? 20000 : 4000}
            onKeyDown={(e) => {
              if (quickOpen && quickMatches.length) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setQuickIdx((i) => (i + 1) % quickMatches.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setQuickIdx((i) => (i - 1 + quickMatches.length) % quickMatches.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  applyQuick(quickMatches[quickIdx] ?? quickMatches[0]);
                  return;
                }
              }
              if (quickOpen && e.key === 'Escape') {
                e.preventDefault();
                setQuickDismissed(true);
                return;
              }
              if (e.key === 'Escape' && replyTo) {
                onCancelReply();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            data-testid="composer-input"
          />
          {draft.trim() ? (
            <button type="submit" className="dm-btn-text" disabled={!draft.trim()} data-testid="composer-send">
              Отправить
            </button>
          ) : (
            <div className="dm-tools">
              <button
                type="button"
                className="dm-tool"
                title="Быстрые ответы — или наберите «/»"
                aria-label="Быстрые ответы"
                onClick={() => {
                  setQuickDismissed(false);
                  setDraft('/');
                  requestAnimationFrame(() => taRef.current?.focus());
                }}
                data-testid="quick-btn"
              >
                <Icon name="bolt" size={22} />
              </button>
              {meta && (
                <>
                  <button type="button" className="dm-tool" title="Голосовое" aria-label="Голосовое" onClick={startRecording} disabled={busy} data-testid="voice-btn">
                    <Icon name="mic" size={22} />
                  </button>
                  <button type="button" className="dm-tool" title="Фото, видео или PDF" aria-label="Фото, видео или PDF" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="attach-btn">
                    <Icon name="image" size={22} />
                  </button>
                  <button type="button" className="dm-tool" title="Место на карте" aria-label="Место на карте" onClick={() => setLocationOpen(true)} disabled={busy} data-testid="location-btn">
                    <Icon name="location_on" size={22} />
                  </button>
                </>
              )}
            </div>
          )}
          {meta && (
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".jpg,.jpeg,.png,.pdf,.mp4,.mov,image/jpeg,image/png,application/pdf,video/mp4,video/quicktime"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
              data-testid="attach-input"
            />
          )}
        </form>
      )}
      {meta && draft && bytes > limit * 0.8 && (
        <div className={`dm-bytes${bytes > limit ? ' over' : ''}`} data-testid="byte-counter">
          {bytes} / {limit} байт{parts > 1 ? ` — уйдёт ${parts} сообщениями` : ''}
        </div>
      )}
      <AnimatePresence>
        {locationOpen && (
          <Suspense key="loc" fallback={null}>
            <LocationPicker onClose={() => setLocationOpen(false)} onSend={onSendLocation} />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
}
