import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Payslip } from '../api/types';
import { canManageFinance } from '../api/types';
import { updatePayslip } from '../api/payroll';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

type Props = {
  payslip: Payslip;
  onClose: () => void;
  onSaved: () => void;
};

const ADJUSTMENT_RE = /^-?\d{1,10}(\.\d{1,2})?$/;
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Раздел 5 ТЗ (волна 6) — ручная правка черновика листа перед утверждением.
 * Только FOUNDER (проверяет бэкенд), только DRAFT. adjustmentAmount МОЖЕТ
 * быть отрицательной — так делается возврат бонуса за расторгнутый договор,
 * а не пересчётом прошлого периода (см. immutability проекта архитектора).
 */
export default function PayslipAdjustModal({ payslip, onClose, onSaved }: Props) {
  const { toast } = useUI();
  /**
   * ТЗ v3 раздел 4 — защита в глубину, как в PaymentFormModal и
   * ScheduleEditModal. Путь сюда уже закрыт в Payroll.tsx (кнопка
   * «Корректировка» внутри блока canManage), но кнопка записи не должна
   * зависеть от того, кто открыл модалку: инвариант обязан держаться в самом
   * компоненте, иначе следующая точка входа откроет её мимо проверки.
   */
  const me = useAuth((s) => s.user);
  const canManage = canManageFinance(me?.role);
  const [adjustmentAmount, setAdjustmentAmount] = useState(payslip.adjustmentAmount !== '0.00' ? payslip.adjustmentAmount : '');
  const [adjustmentReason, setAdjustmentReason] = useState(payslip.adjustmentReason ?? '');
  const [baseOverride, setBaseOverride] = useState(payslip.baseOverride ?? '');
  const [baseOverrideReason, setBaseOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);

  const adjustmentTouched = adjustmentAmount.trim() !== '' || payslip.adjustmentReason;
  const adjustmentValid = !adjustmentTouched || (ADJUSTMENT_RE.test(adjustmentAmount) && adjustmentReason.trim().length > 0);
  const overrideTouched = baseOverride.trim() !== '';
  const overrideValid = !overrideTouched || (MONEY_RE.test(baseOverride) && baseOverrideReason.trim().length > 0);
  const formInvalid = !adjustmentValid || !overrideValid;

  const onSubmit = async () => {
    if (formInvalid) {
      toast('Для корректировки и замены оклада обязательна причина', 'error');
      return;
    }
    setSaving(true);
    try {
      await updatePayslip(payslip.id, {
        adjustmentAmount: adjustmentAmount.trim() !== '' ? adjustmentAmount.trim() : undefined,
        adjustmentReason: adjustmentAmount.trim() !== '' ? adjustmentReason.trim() : undefined,
        baseOverride: overrideTouched ? baseOverride.trim() : undefined,
        baseOverrideReason: overrideTouched ? baseOverrideReason.trim() : undefined,
      });
      toast('Черновик листа обновлён', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения корректировки', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card"
        style={{ maxWidth: 480 }}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">Корректировка листа — {payslip.user.fullName} · {payslip.periodKey}</div>

        <div className="form-group" style={{ textAlign: 'left' }}>
          <label>Замена оклада в этом листе (сомони)</label>
          <input
            value={baseOverride}
            onChange={(e) => setBaseOverride(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={payslip.baseAmount}
            disabled={saving}
          />
        </div>
        {overrideTouched && (
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label>Причина замены оклада *</label>
            <textarea value={baseOverrideReason} onChange={(e) => setBaseOverrideReason(e.target.value)} maxLength={2000} disabled={saving} />
          </div>
        )}

        <div className="form-group" style={{ textAlign: 'left' }}>
          <label>Ручная корректировка (сомони, может быть отрицательной)</label>
          <input
            value={adjustmentAmount}
            onChange={(e) => setAdjustmentAmount(e.target.value.replace(/[^\d.-]/g, ''))}
            placeholder="0.00"
            disabled={saving}
          />
        </div>
        {adjustmentTouched && (
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label>Причина корректировки *</label>
            <textarea value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} maxLength={2000} disabled={saving} />
          </div>
        )}

        <div className="dialog-actions">
          {/* Без права записи «Отмена» превращается в «Закрыть» — иначе
              единственная кнопка окна предлагает отменить то, чего человек
              всё равно не мог сделать. */}
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {canManage ? 'Отмена' : 'Закрыть'}
          </button>
          {canManage && (
            <button className="btn btn-primary" onClick={onSubmit} disabled={saving || formInvalid}>
              {saving ? 'Сохранение…' : 'Сохранить'}
              {!saving && <Icon name="check" size={16} style={{ marginLeft: 4 }} />}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
