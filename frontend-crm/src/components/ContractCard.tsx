import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { Contract } from '../api/types';
import { isFounder, isPrivileged } from '../api/types';
import { completeContract, linkContractPayments, listContracts, signContract, terminateContract } from '../api/contracts';
import { getPaymentSchedule } from '../api/payments';
import type { PaymentScheduleRow } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { formatMoney } from '../utils/money';
import ContractStatusBadge from './ContractStatusBadge';
import ContractFormModal from './ContractFormModal';
import PaymentReasonPrompt from './PaymentReasonPrompt';
import Icon from '../Icon';

type ApplicationOption = { id: string; fullName: string; status: string };

type Props = {
  studentId: string;
  applications?: ApplicationOption[];
  /** Может ли текущий пользователь вести карточку студента — та же граница, что у PaymentsSection/GrantCard. */
  canEdit: boolean;
};

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');

/** Небольшая модалка выбора даты подписания — тот же визуальный каркас, что у PaymentReasonPrompt. */
function SignDatePrompt({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (date: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const valid = !!date && date <= today;

  return (
    <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}>
      <motion.div
        className="dialog-card"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-icon"><Icon name="edit_calendar" size={28} /></div>
        <div className="dialog-title">Отметить подписанным</div>
        <div className="dialog-message">Укажите фактическую дату подписания — на ней считаются все метрики раздела 5.</div>
        <div className="form-group" style={{ textAlign: 'left' }}>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} autoFocus />
          {!valid && <div className="form-error-text">Дата подписания не может быть в будущем</div>}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Отмена</button>
          <button className="btn btn-primary" disabled={!valid} onClick={() => onConfirm(date)}>Подписан</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Раздел 5 ТЗ (волна 6) — блок «Договор» в карточке студента, рядом с
 * PaymentsSection. Связь с графиком платежей показана явно: для подписанного
 * договора видно, сколько строк графика уже привязано (contractId).
 */
export default function ContractCard({ studentId, applications = [], canEdit }: Props) {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [schedule, setSchedule] = useState<PaymentScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<
    | { kind: 'create' }
    | { kind: 'edit'; contract: Contract }
    | { kind: 'sign'; contract: Contract }
    | { kind: 'terminate'; contract: Contract }
    | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isPriv = isPrivileged(me?.role);
  const isFdr = isFounder(me?.role);

  const load = () => {
    setLoading(true);
    Promise.all([
      listContracts({ studentId, pageSize: 20 }),
      getPaymentSchedule(studentId).catch(() => [] as PaymentScheduleRow[]),
    ])
      .then(([c, s]) => { setContracts(c.items); setSchedule(s); })
      .catch(() => { setContracts([]); setSchedule([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useRealtime({
    'contract:updated': (d: any) => { if (d?.studentId === studentId) load(); },
  });

  const linkageFor = (c: Contract) => {
    const linked = schedule.filter((r) => r.contractId === c.id);
    const unlinkedTotal = schedule.filter((r) => r.contractId === null).length;
    return { linkedCount: linked.length, totalStages: schedule.length, unlinkedTotal };
  };

  const onSign = async (contract: Contract, date: string) => {
    setBusyId(contract.id);
    try {
      await signContract(contract.id, date);
      toast('Договор подписан', 'success');
      setModal(null);
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка подписания договора', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onTerminate = async (contract: Contract, reason: string) => {
    setBusyId(contract.id);
    try {
      await terminateContract(contract.id, reason);
      toast('Договор расторгнут', 'success');
      setModal(null);
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка расторжения договора', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onComplete = async (contract: Contract) => {
    const ok = await confirm({
      title: 'Отметить договор исполненным',
      message: 'Все этапы оплачены, студент уехал. Действие фиксируется в журнале активности.',
      confirmText: 'Исполнен',
    });
    if (!ok) return;
    setBusyId(contract.id);
    try {
      await completeContract(contract.id);
      toast('Договор отмечен исполненным', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onLinkPayments = async (contract: Contract) => {
    const ok = await confirm({
      title: 'Привязать платежи и график',
      message: 'Все ещё не привязанные платежи и строки графика этого студента получат ссылку на данный договор. Действие можно повторять.',
      confirmText: 'Привязать',
    });
    if (!ok) return;
    setBusyId(contract.id);
    try {
      const res = await linkContractPayments(contract.id);
      toast(`Привязано платежей: ${res.paymentsLinked}, строк графика: ${res.scheduleLinked}`, 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка привязки', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const renderContract = (c: Contract) => {
    const link = linkageFor(c);
    const showLinkage = c.status === 'SIGNED' || c.status === 'COMPLETED';
    return (
      <motion.div key={c.id} className="grant-item" layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <div className="grant-item-head">
          <div className="grant-item-title">
            <Link to={`/contracts/${c.id}`} style={{ color: 'inherit' }}>{c.number}</Link>
          </div>
          <ContractStatusBadge status={c.status} />
        </div>

        <div className="grant-item-figures">
          <div><span>Сумма</span><strong>{formatMoney(c.amount)}</strong></div>
          <div><span>Ответственный</span><strong>{c.manager?.fullName ?? '—'}</strong></div>
          <div><span>Подписан</span><strong>{fmtDate(c.signedAt)}</strong></div>
          {c.status === 'TERMINATED' && <div><span>Расторгнут</span><strong>{fmtDate(c.terminatedAt)}</strong></div>}
          {c.relocatedAt && <div><span>Переезд</span><strong>{fmtDate(c.relocatedAt)}</strong></div>}
        </div>

        {showLinkage && schedule.length > 0 && (
          <div className="contract-linkage">
            <Icon name="link" size={14} />
            Привязано к графику: {link.linkedCount} из {link.totalStages} этапов
            {link.unlinkedTotal > 0 && ` · ещё ${link.unlinkedTotal} не привязано`}
          </div>
        )}

        {c.note && <div className="grant-item-note">{c.note}</div>}

        {canEdit && (
          <div className="grant-item-actions">
            {c.status === 'DRAFT' && (
              <button className="btn btn-sm btn-primary" onClick={() => setModal({ kind: 'sign', contract: c })} disabled={busyId === c.id}>
                <Icon name="draw" size={15} style={{ marginRight: 4 }} />
                Отметить подписанным
              </button>
            )}
            {c.status === 'DRAFT' && (
              <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'edit', contract: c })} disabled={busyId === c.id}>
                Изменить
              </button>
            )}
            {c.status !== 'DRAFT' && isFdr && (
              <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'edit', contract: c })} disabled={busyId === c.id}>
                Изменить
              </button>
            )}
            {c.status === 'SIGNED' && isPriv && (
              <button className="btn btn-sm btn-danger" onClick={() => setModal({ kind: 'terminate', contract: c })} disabled={busyId === c.id}>
                Расторгнуть
              </button>
            )}
            {c.status === 'SIGNED' && isPriv && (
              <button className="btn btn-sm btn-secondary" onClick={() => onComplete(c)} disabled={busyId === c.id}>
                Исполнен
              </button>
            )}
            {(c.status === 'SIGNED' || c.status === 'COMPLETED') && isFdr && link.unlinkedTotal > 0 && (
              <button className="btn btn-sm btn-secondary" onClick={() => onLinkPayments(c)} disabled={busyId === c.id}>
                <Icon name="link" size={15} style={{ marginRight: 4 }} />
                Привязать платежи
              </button>
            )}
          </div>
        )}
      </motion.div>
    );
  };

  const hasActive = contracts.some((c) => c.status === 'DRAFT' || c.status === 'SIGNED');

  return (
    <div className="grant-card">
      <div className="grant-card-header">
        <div className="grant-card-title">
          <Icon name="description" size={18} style={{ marginRight: 6 }} />
          {contracts.length > 1 ? 'Договоры' : 'Договор'}
        </div>
        {canEdit && !hasActive && (
          <button className="btn btn-sm btn-secondary" onClick={() => setModal({ kind: 'create' })}>
            <Icon name="add" size={15} style={{ marginRight: 4 }} />
            Оформить договор
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty" style={{ padding: 16 }}>Загрузка...</div>
      ) : contracts.length === 0 ? (
        <div className="grant-card-empty">Договор не оформлен</div>
      ) : (
        <div className="grant-card-list">{contracts.map(renderContract)}</div>
      )}

      <AnimatePresence>
        {modal?.kind === 'create' && (
          <ContractFormModal key="create" studentId={studentId} applications={applications} onClose={() => setModal(null)} onSaved={load} />
        )}
        {modal?.kind === 'edit' && (
          <ContractFormModal
            key="edit"
            studentId={studentId}
            applications={applications}
            contract={modal.contract}
            onClose={() => setModal(null)}
            onSaved={load}
          />
        )}
        {modal?.kind === 'sign' && (
          <SignDatePrompt key="sign" onCancel={() => setModal(null)} onConfirm={(date) => onSign(modal.contract, date)} />
        )}
        {modal?.kind === 'terminate' && (
          <PaymentReasonPrompt
            key="terminate"
            title="Расторгнуть договор"
            message="Действие необратимо переводит договор в состояние «Расторгнут». Возврат бонуса менеджеру оформляется отдельной корректировкой в расчётном листе."
            confirmText="Расторгнуть"
            danger
            onCancel={() => setModal(null)}
            onConfirm={(reason) => onTerminate(modal.contract, reason)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
