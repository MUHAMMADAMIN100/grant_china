import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import Icon from '../../Icon';
import { byteLength, checkChatFile, splitByBytes, TEXT_LIMIT_BYTES, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from '../../utils/chatLimits';

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

  const pickFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file || !meta) return;
    const err = checkChatFile(channel as 'INSTAGRAM' | 'WHATSAPP', file);
    if (err) return setFileError(err);
    setBusy(true);
    await onSendFile(file);
    setBusy(false);
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
      {rec.state !== 'idle' ? (
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
              <button type="button" className="chat-tool" title="Фото или PDF" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="attach-btn">
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
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                onChange={(e) => {
                  void pickFile(e.target.files?.[0]);
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
