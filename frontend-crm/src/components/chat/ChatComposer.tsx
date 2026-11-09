import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Icon from '../../Icon';
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

// Карта (Leaflet, ~150 КБ) грузится, только когда открывают «Место на карте».
const LocationPicker = lazy(() => import('./LocationPicker'));

export interface ComposerEdit {
  messageId: string;
  text: string;
  /** true — неушедшее сообщение: исправленный текст уйдёт на его же месте. */
  retry: boolean;
}

/**
 * 29.10.2026 — поле ответа в «Диалогах».
 *
 * Очищается сразу по нажатию «Отправить», как в мессенджере: то, что
 * сотрудник пишет во время отправки, — уже следующее сообщение. Не дошло до
 * сервера — текст возвращается в поле, если там ещё не начато новое.
 * Пределы те же, что на сервере: байты текста, типы и размеры файлов.
 * Telegram умеет только текст; Instagram и WhatsApp — ещё файлы, голосовые и место.
 */
export default function ChatComposer({
  channel,
  disabledReason,
  edit,
  onCancelEdit,
  onSendText,
  onSendFile,
  onSendVoice,
  onSendLocation,
}: {
  channel: string;
  disabledReason: string | null;
  edit: ComposerEdit | null;
  onCancelEdit: () => void;
  onSendText: (text: string, edit: ComposerEdit | null) => Promise<boolean>;
  onSendFile: (file: File) => Promise<boolean>;
  onSendVoice: (blob: Blob) => Promise<boolean>;
  onSendLocation: (loc: { latitude: number; longitude: number; name?: string; address?: string }) => Promise<boolean>;
}) {
  const meta = channel === 'INSTAGRAM' || channel === 'WHATSAPP';
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  draftRef.current = draft;
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  // Голосовое: idle → recording → preview
  const [rec, setRec] = useState<{ state: 'idle' | 'recording' | 'preview'; seconds: number; blob?: Blob; url?: string }>({ state: 'idle', seconds: 0 });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [busy, setBusy] = useState(false);
  // 09.11.2026 — выбранный файл сначала показывается (фото, видео, PDF), уходит по «Отправить».
  const [picked, setPicked] = useState<{ file: File; kind: ChatFileKind; url: string } | null>(null);
  const pickedUrlRef = useRef<string | null>(null);
  pickedUrlRef.current = picked?.url ?? null;
  useEffect(() => () => {
    if (pickedUrlRef.current) URL.revokeObjectURL(pickedUrlRef.current);
  }, []);

  useEffect(() => {
    if (edit) setDraft(edit.text);
  }, [edit]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const limit = meta ? TEXT_LIMIT_BYTES[channel as 'INSTAGRAM' | 'WHATSAPP'] : 0;
  const bytes = meta ? byteLength(draft.trim()) : 0;
  const parts = useMemo(() => (meta && bytes > limit ? splitByBytes(draft, limit).length : 1), [meta, bytes, limit, draft]);

  const send = async () => {
    const text = draft.trim();
    if (!text || disabledReason) return;
    const editCtx = edit;
    setDraft('');
    const ok = await onSendText(text, editCtx);
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
      <div className="conv-composer-disabled" data-testid="composer-disabled">
        <Icon name="info" size={16} />
        {disabledReason}
      </div>
    );
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="chat-composer-wrap">
      {edit && (
        <div className="chat-edit-bar" data-testid="edit-bar">
          <Icon name="edit" size={14} />
          {edit.retry ? 'Исправление неушедшего сообщения — уйдёт на его месте' : 'Исправление — уйдёт новым сообщением'}
          <button type="button" onClick={() => { onCancelEdit(); setDraft(''); }} aria-label="Отменить исправление">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {fileError && <div className="chat-composer-error">{fileError}</div>}
      {picked ? (
        <div className="conv-composer chat-file-preview" data-testid="file-preview">
          {picked.kind === 'IMAGE' && <img src={picked.url} alt="" className="chat-file-preview-media" />}
          {picked.kind === 'VIDEO' && <video src={picked.url} controls playsInline preload="metadata" className="chat-file-preview-media" data-testid="file-preview-video" />}
          {picked.kind === 'FILE' && <Icon name="picture_as_pdf" size={32} />}
          <div className="chat-file-preview-info">
            <div className="chat-file-preview-name">{picked.file.name}</div>
            <div className="chat-file-preview-size">
              {picked.kind === 'VIDEO' ? 'Видео' : picked.kind === 'IMAGE' ? 'Фото' : 'PDF'} · {(picked.file.size / 1048576).toFixed(picked.file.size < 1048576 ? 2 : 1)} МБ
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={discardFile} disabled={busy}>Удалить</button>
          <button type="button" className="btn btn-primary" onClick={sendFile} disabled={busy} data-testid="file-send">
            <Icon name="send" size={18} /> {busy ? (picked.kind === 'VIDEO' ? 'Загружаем…' : '…') : 'Отправить'}
          </button>
        </div>
      ) : rec.state !== 'idle' ? (
        <div className="conv-composer chat-voice-bar" data-testid="voice-bar">
          {rec.state === 'recording' ? (
            <>
              <span className="chat-rec-dot" />
              <span className="chat-rec-time">{mmss(rec.seconds)} / 5:00</span>
              <button type="button" className="btn btn-primary" onClick={stopRecording} data-testid="voice-stop">
                <Icon name="stop" size={18} /> Стоп
              </button>
            </>
          ) : (
            <>
              <audio src={rec.url} controls className="chat-audio" />
              <button type="button" className="btn btn-secondary" onClick={discardVoice} disabled={busy}>Удалить</button>
              <button type="button" className="btn btn-primary" onClick={sendVoice} disabled={busy} data-testid="voice-send">
                <Icon name="send" size={18} /> {busy ? '…' : 'Отправить'}
              </button>
            </>
          )}
        </div>
      ) : (
        <form
          className="conv-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {meta && (
            <div className="chat-tools">
              <button type="button" className="chat-tool" title="Фото, видео или PDF" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="attach-btn">
                <Icon name="attach_file" size={20} />
              </button>
              <button type="button" className="chat-tool" title="Голосовое" onClick={startRecording} disabled={busy} data-testid="voice-btn">
                <Icon name="mic" size={20} />
              </button>
              <button type="button" className="chat-tool" title="Место на карте" onClick={() => setLocationOpen(true)} disabled={busy} data-testid="location-btn">
                <Icon name="location_on" size={20} />
              </button>
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
            </div>
          )}
          <div className="chat-textarea-box">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Напишите ответ..."
              rows={2}
              maxLength={meta ? 20000 : 4000}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              data-testid="composer-input"
            />
            {meta && draft && (
              <div className={`chat-bytes${bytes > limit ? ' over' : ''}`} data-testid="byte-counter">
                {bytes} / {limit} байт{parts > 1 ? ` — уйдёт ${parts} сообщениями` : ''}
              </div>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!draft.trim()} data-testid="composer-send">
            <Icon name="send" size={18} />
            Отправить
          </button>
        </form>
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
