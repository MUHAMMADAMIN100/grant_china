import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Contract } from '../api/types';
import { PAYMENT_AMOUNT_RE, isPrivileged } from '../api/types';
import { createContract, updateContract } from '../api/contracts';
import { listUsers } from '../api/users';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import Icon from '../Icon';

type ApplicationOption = { id: string; fullName: string; status: string };

type Props = {
  studentId: string;
  /** Заявки этого студента — для выбора заявки-источника (атрибуция конверсии). */
  applications?: ApplicationOption[];
  /** Если передан — форма в режиме редактирования уже существующего договора. */
  contract?: Contract | null;
  /** Предзаполнить заявку-источник (создание договора со страницы заявки). */
  defaultApplicationId?: string;
  onClose: () => void;
  onSaved: (contract: Contract) => void;
};

/**
 * Раздел 5 ТЗ (волна 6) — создание/правка договора. Договор — ОТДЕЛЬНАЯ
 * СУЩНОСТЬ (решение заказчика), суммы и ответственный заполняются здесь,
 * а подписание — отдельное действие «Отметить подписанным» (ContractCard/
 * ContractDetail), у него обязана быть дата.
 */
export default function ContractFormModal({ studentId, applications = [], contract, defaultApplicationId, onClose, onSaved }: Props) {
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  const isEdit = !!contract;
  const isPriv = isPrivileged(me?.role);
  // После подписания сумму/заявку/ответственного может менять только
  // FOUNDER (см. contracts.service.ts update()) — заморозка отражена и в форме.
  const frozen = isEdit && contract!.status !== 'DRAFT' && me?.role !== 'FOUNDER';

  const [amount, setAmount] = useState(contract?.amount ?? '0');
  const [applicationId, setApplicationId] = useState(contract?.applicationId ?? defaultApplicationId ?? '');
  const [managerId, setManagerId] = useState(contract?.managerId ?? '');
  const [note, setNote] = useState(contract?.note ?? '');
  const [managers, setManagers] = useState<{ id: string; fullName: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (isPriv) listUsers().then(setManagers).catch(() => {});
  }, [isPriv]);

  const amountValid = amount === '' || PAYMENT_AMOUNT_RE.test(amount);
  const formInvalid = !amountValid;

  const onSubmit = async () => {
    setTouched(true);
    if (formInvalid) {
      toast('Проверьте сумму договора', 'error');
      return;
    }
    setSaving(true);
    try {
      let saved: Contract;
      if (isEdit && contract) {
        saved = await updateContract(contract.id, {
          amount: frozen ? undefined : amount || undefined,
          applicationId: frozen ? undefined : applicationId || null,
          managerId: frozen || !isPriv ? undefined : managerId || null,
          note: note.trim() || null,
        });
        toast('Договор обновлён', 'success');
      } else {
        saved = await createContract({
          studentId,
          applicationId: applicationId || undefined,
          amount: amount || undefined,
          managerId: isPriv && managerId ? managerId : undefined,
          note: note.trim() || undefined,
        });
        toast('Договор создан (черновик)', 'success');
      }
      onSaved(saved);
      onClose();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения договора', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog-card payment-form-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-form-header">
          <div className="dialog-title" style={{ marginBottom: 2 }}>
            {isEdit ? `Договор ${contract!.number}` : 'Новый договор'}
          </div>
        </div>

        {frozen && (
          <div className="receipt-dropzone-hint" style={{ marginBottom: 14 }}>
            Договор подписан — сумму, заявку-источник и ответственного может изменить только Основатель.
          </div>
        )}

        <div className="form-group">
          <label>Сумма договора (сомони)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => setTouched(true)}
            className={touched && !amountValid ? 'input-error' : ''}
            placeholder="0.00"
            disabled={saving || frozen}
          />
          {touched && !amountValid && <div className="form-error-text">Введите число (до 2 знаков после точки)</div>}
        </div>

        {applications.length > 0 && (
          <div className="form-group">
            <label>Заявка-источник</label>
            <select value={applicationId} onChange={(e) => setApplicationId(e.target.value)} disabled={saving || frozen}>
              <option value="">Не указана</option>
              {applications.map((a) => (
                <option key={a.id} value={a.id}>{a.fullName}</option>
              ))}
            </select>
          </div>
        )}

        {isPriv && (
          <div className="form-group">
            <label>Ответственный за договор</label>
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={saving || frozen}>
              <option value="">Менеджер студента (по умолчанию)</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
            <div className="receipt-dropzone-hint">Тому, кто здесь указан, идёт бонус за этот договор.</div>
          </div>
        )}

        <div className="form-group">
          <label>Примечание</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={saving} />
        </div>

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving}>
            {saving ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Создать'}
            {!saving && <Icon name="check" size={16} style={{ marginLeft: 4 }} />}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
