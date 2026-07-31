import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { Payslip, PayslipStatus } from '../api/types';
import { PAYSLIP_STATUS_LABEL, isFounder } from '../api/types';
import {
  approvePayslip,
  deletePayslip,
  generatePayslips,
  getPayrollSummary,
  payPayslip,
  reissuePayslip,
  recallPayslip,
  recalculatePayslip,
  voidPayslip,
} from '../api/payroll';
import type { PayrollSummary } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { currentMonthKey } from '../utils/datetime';
import { formatMoney } from '../utils/money';
import { exportPayrollCsv } from '../utils/payrollReport';
import PayslipStatusBadge from '../components/PayslipStatusBadge';
import PayslipDetailModal from '../components/PayslipDetailModal';
import PayslipAdjustModal from '../components/PayslipAdjustModal';
import PaymentReasonPrompt from '../components/PaymentReasonPrompt';
import CompensationPanel from '../components/CompensationPanel';
import Icon from '../Icon';

const STATUS_OPTIONS: PayslipStatus[] = ['DRAFT', 'APPROVED', 'PAID', 'VOID'];

/**
 * ТЗ 5.2 «интерфейс руководства» — сводная ведомость зарплат, утверждение
 * начислений и фиксация выплат. Кнопки действий рендерятся строго по тому
 * же условию, что проверяет бэкенд (payslips.service.ts) — показ кнопки,
 * ведущей в 403, запрещён правилами проекта.
 */
export default function Payroll() {
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isFdr = isFounder(me?.role);

  const defaults = useMemo(() => ({ period: currentMonthKey(), status: '' }), []);
  const [filters, setFilter] = useUrlFilter(defaults);
  const period = filters.period || currentMonthKey();
  const status = filters.status as PayslipStatus | '';

  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Payslip | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Payslip | null>(null);
  const [recallTarget, setRecallTarget] = useState<Payslip | null>(null);
  const [voidTarget, setVoidTarget] = useState<Payslip | null>(null);
  const [compensationOpen, setCompensationOpen] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);

  const load = () => {
    setLoading(true);
    getPayrollSummary(period).then(setSummary).catch(() => setSummary(null)).finally(() => setLoading(false));
  };
  useEffect(load, [period]);

  useRealtime({
    'payslip:updated': load,
  });

  const items = summary ? summary.items.filter((p) => !status || p.status === status) : [];

  const onGenerate = async () => {
    const ok = await confirm({
      title: 'Сгенерировать листы за период',
      message: `Будут созданы черновики расчётных листов за ${period} всем менеджерам и администраторам, у кого их ещё нет. Действие идемпотентно — повторный запуск ничего не сломает.`,
      confirmText: 'Сгенерировать',
    });
    if (!ok) return;
    try {
      const res = await generatePayslips(period);
      toast(`Создано: ${res.created}, уже существовало: ${res.skipped}`, 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка генерации листов', 'error');
    }
  };

  const onRecalculate = async (p: Payslip) => {
    setBusyId(p.id);
    try {
      await recalculatePayslip(p.id);
      toast('Лист пересчитан', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка пересчёта', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onApprove = async (p: Payslip) => {
    const ok = await confirm({
      title: 'Утвердить начисление',
      message: `${p.user.fullName} · ${p.periodKey}: ${formatMoney(p.totalAmount)}. После утверждения состав листа замораживается.`,
      confirmText: 'Утвердить',
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      await approvePayslip(p.id, p.totalAmount);
      toast('Начисление утверждено', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка утверждения', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onBulkApprove = async () => {
    const approvable = items.filter((p) => p.status === 'DRAFT' && p.userId !== me?.id && (isFdr || p.user.role === 'EMPLOYEE'));
    if (approvable.length === 0) return;
    const ok = await confirm({
      title: 'Утвердить все черновики',
      message: `Будет утверждено ${approvable.length} листов по одному запросу на каждый — свои листы и листы администраторов (для роли Администратор) пропускаются автоматически.`,
      confirmText: 'Утвердить все',
    });
    if (!ok) return;
    setBulkApproving(true);
    let okCount = 0;
    let failCount = 0;
    for (const p of approvable) {
      try {
        await approvePayslip(p.id, p.totalAmount);
        okCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setBulkApproving(false);
    toast(`Утверждено: ${okCount}${failCount ? `, не удалось: ${failCount}` : ''}`, failCount ? 'error' : 'success');
    load();
  };

  const onPay = async (p: Payslip) => {
    const ok = await confirm({
      title: 'Зафиксировать выплату',
      message: `Подтвердите фактическую выплату ${formatMoney(p.totalAmount)} — ${p.user.fullName} за ${p.periodKey}. После фиксации лист становится полностью неизменяемым.`,
      confirmText: 'Выплачено',
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      await payPayslip(p.id);
      toast('Выплата зафиксирована', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка фиксации выплаты', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onReissue = async (p: Payslip) => {
    setBusyId(p.id);
    try {
      await reissuePayslip(p.id);
      toast('Создана новая ревизия листа', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка переиздания', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onDeleteDraft = async (p: Payslip) => {
    const ok = await confirm({
      title: 'Удалить черновик',
      message: `Черновик листа ${p.user.fullName} за ${p.periodKey} будет удалён.`,
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePayslip(p.id);
      toast('Черновик удалён', 'success');
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  const onConfirmRecall = async (reason: string) => {
    if (!recallTarget) return;
    try {
      await recallPayslip(recallTarget.id, reason);
      toast('Лист возвращён в черновик', 'success');
      setRecallTarget(null);
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка возврата в черновик', 'error');
    }
  };

  const onConfirmVoid = async (reason: string) => {
    if (!voidTarget) return;
    try {
      await voidPayslip(voidTarget.id, reason);
      toast('Лист аннулирован', 'success');
      setVoidTarget(null);
      load();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка аннулирования', 'error');
    }
  };

  const draftCount = items.filter((p) => p.status === 'DRAFT').length;

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="card-header">
        <h2 className="card-title">Зарплаты</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/payroll/rules" className="btn btn-sm btn-secondary">
            <Icon name="tune" size={16} style={{ marginRight: 4 }} />
            Формулы бонусов
          </Link>
          {isFdr && (
            <button className="btn btn-sm btn-secondary" onClick={() => setCompensationOpen(true)}>
              <Icon name="badge" size={16} style={{ marginRight: 4 }} />
              Оклады
            </button>
          )}
        </div>
      </div>

      <div className="card-body">
        <div className="period-picker">
          <div className="period-controls">
            <input type="month" value={period} onChange={(e) => setFilter('period', e.target.value)} max={currentMonthKey()} />
            <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">Все статусы</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{PAYSLIP_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-secondary" onClick={onGenerate}>
              <Icon name="playlist_add" size={16} style={{ marginRight: 4 }} />
              Сгенерировать листы
            </button>
            {draftCount > 0 && (
              <button className="btn btn-sm btn-primary" onClick={onBulkApprove} disabled={bulkApproving}>
                <Icon name="task_alt" size={16} style={{ marginRight: 4 }} />
                {bulkApproving ? 'Утверждение…' : `Утвердить все (${draftCount})`}
              </button>
            )}
            {items.length > 0 && (
              <button className="btn btn-sm btn-secondary" onClick={() => exportPayrollCsv(items, period)}>
                <Icon name="download" size={16} style={{ marginRight: 4 }} />
                CSV
              </button>
            )}
          </div>
        </div>

        {summary && (
          <div className="payments-totals" style={{ marginTop: 4, marginBottom: 16 }}>
            <div><span>Утверждено за период</span><strong className="text-success">{formatMoney(summary.fundApproved)}</strong></div>
            <div><span>Выплачено за период</span><strong>{formatMoney(summary.fundPaid)}</strong></div>
          </div>
        )}

        {loading ? (
          <div className="empty">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Icon name="payments" size={48} /></div>
            Листов за период не найдено
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Сотрудник</th><th>Оклад</th><th>Бонус</th><th>Премия KPI</th><th>Корректировка</th><th>Итого</th><th>Статус</th><th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const canApprove = p.status === 'DRAFT' && p.userId !== me?.id && (isFdr || p.user.role === 'EMPLOYEE');
                  return (
                    <tr key={p.id} className={p.needsReview ? 'payroll-row-review' : undefined} onClick={() => setDetail(p)} style={{ cursor: 'pointer' }}>
                      <td><strong>{p.user.fullName}</strong>{p.revision > 1 && <span className="mgr-you"> · ред. {p.revision}</span>}</td>
                      <td data-label="Оклад">{formatMoney(p.baseOverride ?? p.baseAmount)}</td>
                      <td data-label="Бонус">{formatMoney(p.bonusAmount)}</td>
                      <td data-label="Премия KPI">{formatMoney(p.kpiBonusAmount)}</td>
                      <td data-label="Корректировка">{formatMoney(p.adjustmentAmount)}</td>
                      <td data-label="Итого"><strong>{formatMoney(p.totalAmount)}</strong>{p.needsReview && <Icon name="warning" size={14} style={{ color: 'var(--danger)', marginLeft: 4 }} />}</td>
                      <td data-label="Статус"><PayslipStatusBadge status={p.status} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="payment-row-actions">
                          {p.status === 'DRAFT' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => onRecalculate(p)} disabled={busyId === p.id}>Пересчитать</button>
                          )}
                          {p.status === 'DRAFT' && isFdr && (
                            <button className="btn btn-sm btn-secondary" onClick={() => setAdjustTarget(p)} disabled={busyId === p.id}>Корректировка</button>
                          )}
                          {canApprove && (
                            <button className="btn btn-sm btn-primary" onClick={() => onApprove(p)} disabled={busyId === p.id}>Утвердить</button>
                          )}
                          {p.status === 'DRAFT' && isFdr && (
                            <button className="btn btn-sm btn-danger" onClick={() => onDeleteDraft(p)} disabled={busyId === p.id}>Удалить</button>
                          )}
                          {p.status === 'APPROVED' && isFdr && (
                            <button className="btn btn-sm btn-secondary" onClick={() => setRecallTarget(p)} disabled={busyId === p.id}>В черновик</button>
                          )}
                          {p.status === 'APPROVED' && isFdr && (
                            <button className="btn btn-sm btn-primary" onClick={() => onPay(p)} disabled={busyId === p.id}>Выплатить</button>
                          )}
                          {(p.status === 'APPROVED' || p.status === 'PAID') && isFdr && (
                            <button className="btn btn-sm btn-danger" onClick={() => setVoidTarget(p)} disabled={busyId === p.id}>Аннулировать</button>
                          )}
                          {p.status === 'VOID' && isFdr && (
                            <button className="btn btn-sm btn-secondary" onClick={() => onReissue(p)} disabled={busyId === p.id}>Переиздать</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {detail && <PayslipDetailModal key="detail" payslip={detail} onClose={() => setDetail(null)} />}
        {adjustTarget && (
          <PayslipAdjustModal
            key="adjust"
            payslip={adjustTarget}
            onClose={() => setAdjustTarget(null)}
            onSaved={load}
          />
        )}
        {recallTarget && (
          <PaymentReasonPrompt
            key="recall"
            title="Вернуть лист в черновик"
            message="Начисление станет снова редактируемым и потребует повторного утверждения."
            confirmText="Вернуть"
            onCancel={() => setRecallTarget(null)}
            onConfirm={onConfirmRecall}
          />
        )}
        {voidTarget && (
          <PaymentReasonPrompt
            key="void"
            title="Аннулировать лист"
            message="Лист исключается из фонда, но остаётся в истории. Действие необратимо (сторно, не удаление)."
            confirmText="Аннулировать"
            danger
            onCancel={() => setVoidTarget(null)}
            onConfirm={onConfirmVoid}
          />
        )}
        {compensationOpen && <CompensationPanel key="comp" onClose={() => setCompensationOpen(false)} />}
      </AnimatePresence>
    </motion.div>
  );
}
