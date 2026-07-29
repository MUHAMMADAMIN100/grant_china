import { useState } from 'react';
import { motion } from 'framer-motion';
import Icon from '../Icon';

type Props = {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/**
 * Модалка ввода причины — для «Отклонить» и «Аннулировать» (ТЗ 1.1: причина
 * обязательна, минимум 5 символов, как на бэкенде — RejectPaymentDto/
 * VoidPaymentDto). ui/Dialogs.confirm() тут не подходит — там только да/нет,
 * без свободного текстового поля.
 */
export default function PaymentReasonPrompt({ title, message, confirmText = 'Подтвердить', danger, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const valid = trimmed.length >= 5;

  return (
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="dialog-card"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`dialog-icon${danger ? ' danger' : ''}`}>
          <Icon name="edit_note" size={28} />
        </div>
        <div className="dialog-title">{title}</div>
        {message && <div className="dialog-message">{message}</div>}
        <div className="form-group" style={{ textAlign: 'left' }}>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина (минимум 5 символов)"
            maxLength={2000}
          />
          {reason.length > 0 && !valid && <div className="form-error-text">Минимум 5 символов</div>}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Отмена</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={!valid}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
