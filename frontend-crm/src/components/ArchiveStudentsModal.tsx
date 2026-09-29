import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { archiveStudents, type ArchiveStudentsResult } from '../api/students';
import { plural } from '../utils/plural';
import Icon from '../Icon';

/** Сколько ФИО показать в окне; остальные — строкой «и ещё N». */
const MAX_NAMES = 8;

/**
 * 29.09.2026 — окно «Отправить в архив». Одно на все места: галочки в списке
 * «Студенты» (пачка) и кнопка «В архив» в карточке (один студент).
 *
 * В окне — кого именно отправляем (чтобы случайно выбранного было видно до
 * нажатия, а не после) и что с ними будет. Комментарий необязательный
 * (решение владельца), он показывается в разделе «Архив», в карточке и в
 * журнале активности.
 */
export default function ArchiveStudentsModal({
  students,
  onClose,
  onDone,
}: {
  students: Array<{ id: string; fullName: string }>;
  onClose: () => void;
  onDone: (result: ArchiveStudentsResult) => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const n = students.length;
  const shown = students.slice(0, MAX_NAMES);
  const rest = n - shown.length;

  const submit = async () => {
    if (busy || n === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await archiveStudents(students.map((s) => s.id), comment);
      onDone(res);
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg || 'Не удалось отправить в архив');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={busy ? undefined : onClose}
    >
      <motion.div
        className="dialog-card archive-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Отправить в архив"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        data-testid="archive-modal"
      >
        <div className="dialog-icon" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
          <Icon name="inventory_2" size={28} />
        </div>
        <div className="dialog-title">
          {n === 1 ? 'Отправить студента в архив' : `Отправить в архив ${n} ${plural(n, 'студента', 'студентов', 'студентов')}`}
        </div>
        <div className="dialog-message" style={{ marginBottom: 12 }}>
          {n === 1 ? 'Студент уйдёт' : 'Студенты уйдут'} из списка «Студенты»: закроется личный кабинет, перестанут
          приходить напоминания, заявки уйдут в архив вместе с {n === 1 ? 'ним' : 'ними'}. Платежи, договоры и документы
          сохранятся. Вернуть можно в разделе «Архив».
        </div>
        <ul className="archive-names" data-testid="archive-names">
          {shown.map((s) => (
            <li key={s.id}>{s.fullName}</li>
          ))}
          {rest > 0 && <li className="archive-names-more">и ещё {rest}</li>}
        </ul>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>
            Комментарий{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>— необязательно</span>
          </label>
          <textarea
            ref={textRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Например: отказался, уехал учиться сам, дубль карточки"
            disabled={busy}
            data-testid="archive-comment"
          />
        </div>
        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Отмена</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || n === 0} data-testid="archive-submit">
            <Icon name="inventory_2" size={16} style={{ marginRight: 4 }} />
            {busy ? 'Отправляем…' : 'В архив'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
