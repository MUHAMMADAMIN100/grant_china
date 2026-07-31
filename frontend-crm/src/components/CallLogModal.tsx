import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CALL_STATUS_LABEL,
  CALL_STATUS_OPTIONS,
  logCall,
  type CallDirection,
  type CallStatus,
} from '../api/calls';
import { useUI } from '../ui/Dialogs';
import { toDatetimeLocalValue } from '../utils/datetime';
import Icon from '../Icon';

type Props = {
  /** К какой карточке привязать звонок. */
  studentId?: string;
  applicationId?: string;
  /** Телефон подставляется из карточки — менеджеру не нужно его набирать. */
  defaultPhone?: string;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * ТЗ 6.2 — ручная фиксация разговора.
 *
 * Форма работает БЕЗ подключённой АТС: заказчик выбрал «пока что каркас
 * подготовь», и до подключения телефонии история звонков наполняется руками.
 * Когда придёт вебхук провайдера, записи начнут появляться автоматически —
 * та же таблица, тот же журнал, форма остаётся для звонков с личного мобильного.
 */
export default function CallLogModal({ studentId, applicationId, defaultPhone, onClose, onSaved }: Props) {
  const { toast } = useUI();
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [direction, setDirection] = useState<CallDirection>('OUTBOUND');
  const [status, setStatus] = useState<CallStatus>('COMPLETED');
  const [startedAt, setStartedAt] = useState(toDatetimeLocalValue(new Date().toISOString()));
  const [minutes, setMinutes] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = phone.trim().length >= 5;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || saving) return;
    setError(null);
    setSaving(true);
    try {
      await logCall({
        phone: phone.trim(),
        direction,
        status,
        startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
        // В интерфейсе минуты — так думает менеджер; в БД секунды.
        durationSec: minutes ? Math.max(0, Math.round(parseFloat(minutes) * 60)) : undefined,
        comment: comment.trim() || undefined,
        studentId,
        applicationId,
      });
      toast('Звонок записан в историю', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message?.toString() || 'Не удалось записать звонок');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="dialog-card"
        style={{ maxWidth: 520, textAlign: 'left' }}
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.2 }}
      >
        <div className="dialog-title" style={{ textAlign: 'left' }}>Записать звонок</div>

        <form onSubmit={onSubmit}>
          {error && <div className="error-banner">{error}</div>}

          <div className="form-group">
            <label>Телефон *</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+992 ..." maxLength={32} />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label>Направление</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as CallDirection)}>
                <option value="OUTBOUND">Исходящий</option>
                <option value="INBOUND">Входящий</option>
              </select>
            </div>
            <div className="form-group">
              <label>Результат</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as CallStatus)}>
                {CALL_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{CALL_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label>Когда</label>
              <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </div>
            <div className="form-group">
              <label>
                Длительность{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>— минут</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="5"
              />
            </div>
          </div>

          <div className="form-group">
            <label>О чём говорили</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} />
          </div>

          <div className="receipt-dropzone-hint">
            <Icon name="info" size={14} /> Запись попадёт в историю звонков карточки и в журнал действий.
          </div>

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || saving}>
              {saving ? 'Сохраняем...' : 'Записать'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
