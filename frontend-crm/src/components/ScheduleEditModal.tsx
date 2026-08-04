import { useState } from 'react';
import { motion } from 'framer-motion';
import type { PaymentStage, PaymentStageSummary } from '../api/types';
import { PAYMENT_AMOUNT_RE, PAYMENT_STAGE_LABEL, canManageFinance } from '../api/types';
import { setPaymentSchedule } from '../api/payments';
import { useAuth } from '../store/auth';
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
 * индивидуальные по каждому договору). Задаёт ТОЛЬКО Основатель — см.
 * payments.controller.ts, PUT /payments/schedule → @Roles(FOUNDER).
 *
 * Раньше здесь значился и ADMIN, но по ТЗ v3 раздел 4 (критерий приёмки №4)
 * Администратор работает с финансами строго в режиме Read-Only, и бэкенд
 * отвечает ему 403. Остальные роли видят план только для чтения.
 */
export default function ScheduleEditModal({ studentId, stage, current, onClose, onSaved }: Props) {
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  /**
   * Защита в глубину: путь сюда уже закрыт в PaymentsSection (карандаш правки
   * плана показывается только Основателю), но кнопка записи живёт здесь —
   * и не должна зависеть от того, кто открыл модалку. Скрываем, а не гасим:
   * disabled-кнопка без объяснения читается как поломка.
   */
  const canManage = canManageFinance(me?.role);
  const [plannedAmount, setPlannedAmount] = useState(current.plannedAmount);
  const [dueDate, setDueDate] = useState(current.dueDate ? current.dueDate.slice(0, 10) : '');
  // Предзаполняем сохранённым комментарием: поле уходит на сервер безусловно
  // (см. onSave), поэтому с пустой инициализацией правка одной только суммы
  // стирала бы уже сохранённый текст.
  const [comment, setComment] = useState(current.comment ?? '');
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
        // Пустую строку шлём как есть, а не undefined: сервис обновляет поле
        // только при dto.comment !== undefined, поэтому на undefined
        // намеренная очистка молча не применялась — тост об успехе был, а
        // после перезагрузки текст возвращался. '' сервис приводит к null.
        comment: comment.trim(),
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
          {/* Без права записи единственное действие — уйти, и подпись «Отмена»
              обманывала бы: отменять нечего. */}
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {canManage ? 'Отмена' : 'Закрыть'}
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
