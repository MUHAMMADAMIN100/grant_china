import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { createApplicationFromChat, type Conversation } from '../../api/messaging';
import DirectionOptions from '../DirectionOptions';

/**
 * 29.10.2026 — «Создать заявку» из чата Instagram / WhatsApp (решение
 * владельца: заявку создаёт менеджер кнопкой). Имя и телефон подставляются из
 * чата, источник — сам канал; направление выбирает менеджер.
 */
export default function ChatApplicationModal({
  conversation,
  onClose,
  onCreated,
}: {
  conversation: Conversation;
  onClose: () => void;
  onCreated: (applicationId: string) => void;
}) {
  const [fullName, setFullName] = useState(conversation.title ?? '');
  const [phone, setPhone] = useState(conversation.channel === 'WHATSAPP' ? `+${(conversation.phone ?? conversation.externalId).replace(/^\+/, '')}` : '');
  const [direction, setDirection] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const digits = phone.replace(/\D/g, '');
  const valid = fullName.trim().length >= 2 && digits.length >= 7 && !!direction;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createApplicationFromChat(conversation.id, { fullName: fullName.trim(), phone: phone.trim(), direction, comment: comment.trim() || undefined });
      onCreated(res.applicationId);
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Не удалось создать заявку');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={busy ? undefined : onClose}>
      <motion.div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label="Создать заявку"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(e) => e.stopPropagation()}
        style={{ textAlign: 'left' }}
        data-testid="chat-application-modal"
      >
        <div className="dialog-title">Создать заявку из чата</div>
        <div className="dialog-message" style={{ marginBottom: 12 }}>
          Источник — {conversation.channel === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp'}. Чат привяжется к заявке, вы станете её менеджером.
        </div>
        <div className="form-group">
          <label>ФИО *</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} data-testid="app-fullname" />
        </div>
        <div className="form-group">
          <label>Телефон *</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d +\-()]/g, ''))} placeholder="+992 90 123 45 67" data-testid="app-phone" />
          {conversation.channel === 'INSTAGRAM' && <div className="chat-optional">Instagram не даёт номер — спросите его у клиента.</div>}
        </div>
        <div className="form-group">
          <label>Направление *</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} data-testid="app-direction">
            <option value="">Выберите</option>
            <DirectionOptions />
          </select>
        </div>
        <div className="form-group">
          <label>Комментарий <span className="chat-optional">— необязательно</span></label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} />
        </div>
        {error && <div className="error-banner" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!valid || busy} data-testid="app-create">
            {busy ? 'Создаём…' : 'Создать заявку'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
