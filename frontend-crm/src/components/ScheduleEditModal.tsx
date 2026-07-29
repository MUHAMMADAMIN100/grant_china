import { useState } from 'react';
import { motion } from 'framer-motion';
import type { PaymentStage, PaymentStageSummary } from '../api/types';
import { PAYMENT_AMOUNT_RE, PAYMENT_STAGE_LABEL } from '../api/types';
import { setPaymentSchedule } from '../api/payments';
import { useUI } from '../ui/Dialogs';

type Props = {
  studentId: string;
  stage: PaymentStage;
  current: PaymentStageSummary;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Индивидуальная плановая сумма/срок этапа договора (ТЗ: суммы этапов
 * индивидуальные по каждому договору). Задаёт только FOUNDER/ADMIN —
 * рядовой менеджер видит план только для чтения (см. payments.controller.ts
 * PUT /payments/schedule — @Roles(FOUNDER, ADMIN)).
 */
export default function ScheduleEditModal({ studentId, stage, current, onClose, onSaved }: Props) {
  const { toast } = useUI();
  const [plannedAmount, setPlannedAmount] = useState(current.plannedAmount);
  const [dueDate, setDueDate] = useState(current.dueDate ? current.dueDate.slice(0, 10) : '');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const amountValid = PAYMENT_AMOUNT_RE.test(plannedAmount);

  const onSave = async () => {
    if (!amountValid) { setTouched(true); toast('Введите корректную сумму', 'error'); return; }
    setSaving(true);
    try {
      await setPaymentSchedule({
        studentId,
        stage,
        plannedAmount,
        dueDate: dueDate || undefined,
        comment: comment.trim() || undefined,
      });
      toast('План этапа обновлён', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения плана', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card"
        style={{ maxWidth: 440 }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">План: {PAYMENT_STAGE_LABEL[stage]}</div>
        <div className="dialog-message">Индивидуальная сумма и срок этого этапа по договору студента.</div>
        <div className="form-group" style={{ textAlign: 'left' }}>
          <label>Плановая сумма (сомони) *</label>
          <input
            value={plannedAmount}
            onChange={(e) => setPlannedAmount(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => setTouched(true)}
            className={touched && !amountValid ? 'input-error' : ''}
            disabled={saving}
          />
          {touched && !amountValid && <div className="form-error-text">Введите число (до 2 знаков после точки)</div>}
        </div>
        <div className="form-group" style={{ textAlign: 'left' }}>
          <label>Плановый срок оплаты</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={saving} />
        </div>
        <div className="form-group" style={{ textAlign: 'left' }}>
          <label>Комментарий</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} disabled={saving} />
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
