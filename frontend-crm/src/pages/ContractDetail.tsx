import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { Contract, PaymentScheduleRow, Student } from '../api/types';
import { canManageFinance, canWriteFinance, isPrivileged } from '../api/types';
import { completeContract, deleteContract, getContract, linkContractPayments, signContract, terminateContract } from '../api/contracts';
import { getPaymentSchedule } from '../api/payments';
import { getStudent } from '../api/students';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { formatMoney } from '../utils/money';
import BackButton from '../components/BackButton';
import ContractStatusBadge from '../components/ContractStatusBadge';
import ContractFormModal from '../components/ContractFormModal';
import { SignDatePrompt } from '../components/ContractCard';
import PaymentReasonPrompt from '../components/PaymentReasonPrompt';
import Icon from '../Icon';

const fmtDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');
const fmtDateTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('ru-RU') : '—');

/**
 * Раздел 5 ТЗ (волна 6) — «карточка» договора. Помимо реквизитов явно
 * показывает связь с графиком платежей студента (Payment/PaymentSchedule
 * привязаны к договору через contractId).
 */
export default function ContractDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();

  const [contract, setContract] = useState<Contract | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [schedule, setSchedule] = useState<PaymentScheduleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'edit' | 'terminate' | 'sign' | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!id) return;
    setError(null);
    try {
      const c = await getContract(id);
      setContract(c);
      const [s, sched] = await Promise.all([
        getStudent(c.studentId).catch(() => null),
        getPaymentSchedule(c.studentId).catch(() => [] as PaymentScheduleRow[]),
      ]);
      setStudent(s);
      setSchedule(sched);
    } catch (e: any) {
      setContract(null);
      setError(e?.response?.data?.message || 'Нет доступа к этому договору');
    }
  };

  useEffect(() => { reload(); }, [id]);

  useRealtime({
    'contract:updated': (d: any) => { if (d?.id === id || d?.studentId === contract?.studentId) reload(); },
  });

  if (error) return <div className="error-banner">{error}</div>;
  if (!contract) return <div className="empty">Загрузка...</div>;

  // isPriv отвечает ТОЛЬКО на вопрос «видна ли пользователю карточка этого
  // студента» — Администратор видит всех, и договоры ему тоже показывают.
  // Права на ДЕЙСТВИЯ считаются отдельно: ТЗ v3 раздел 4, критерий приёмки №4
  // оставляет Администратору финансы строго в режиме чтения, и эндпоинты
  // договора теперь отвечают ему 403. Смешивать эти две границы нельзя.
  const isPriv = isPrivileged(me?.role);
  const canWrite = canWriteFinance(me?.role);   // создание/правка — @Roles(FOUNDER, EMPLOYEE)
  const canManage = canManageFinance(me?.role); // подписание/расторжение/исполнение/удаление/привязка — @Roles(FOUNDER)
  const assigned = !!student?.managerId || !!student?.chinaManagerId;
  const isMine = !assigned || student?.managerId === me?.id || student?.chinaManagerId === me?.id;
  const canEdit = isPriv || isMine;

  const linked = schedule.filter((r) => r.contractId === contract.id);
  const unlinked = schedule.filter((r) => r.contractId === null);
  const otherContract = schedule.filter((r) => r.contractId && r.contractId !== contract.id);

  /**
   * ТЗ v3 р4 — подписание закрыто @Roles(FOUNDER). Действие продублировано
   * здесь, потому что до этого его на странице договора не было: Основатель,
   * открывший договор из общего списка /contracts, мог его изменить, исполнить
   * и расторгнуть, но не подписать — для этого приходилось искать студента и
   * открывать его карточку.
   */
  const onSign = async (signedAt: string) => {
    setBusy(true);
    try {
      await signContract(contract.id, signedAt);
      toast('Договор подписан', 'success');
      setModal(null);
      reload();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка подписания договора', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onTerminate = async (reason: string) => {
    setBusy(true);
    try {
      await terminateContract(contract.id, reason);
      toast('Договор расторгнут', 'success');
      setModal(null);
      reload();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка расторжения договора', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onComplete = async () => {
    const ok = await confirm({
      title: 'Отметить договор исполненным',
      message: 'Все этапы оплачены, студент уехал.',
      confirmText: 'Исполнен',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await completeContract(contract.id);
      toast('Договор отмечен исполненным', 'success');
      reload();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onLinkPayments = async () => {
    const ok = await confirm({
      title: 'Привязать платежи и график',
      message: 'Все ещё не привязанные платежи и строки графика этого студента получат ссылку на данный договор.',
      confirmText: 'Привязать',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await linkContractPayments(contract.id);
      toast(`Привязано платежей: ${res.paymentsLinked}, строк графика: ${res.scheduleLinked}`, 'success');
      reload();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка привязки', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Удалить черновик договора',
      message: 'Действие нельзя отменить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteContract(contract.id);
      toast('Черновик удалён', 'success');
      navigate('/contracts');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  return (
    <div>
      <BackButton fallback="/contracts" />
      <div className="card">
        <div className="card-header">
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {contract.number}
            <ContractStatusBadge status={contract.status} />
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Черновик правит и назначенный менеджер, после подписания
                сумму/заявку/ответственного меняет только Основатель — та же
                развилка, что в contracts.service.ts update(). */}
            {/* Подписание — только Основатель (POST /contracts/:id/sign под
                @Roles(FOUNDER)). Второй участник цепочки: черновик с суммой
                готовит менеджер, подтверждает не он. */}
            {contract.status === 'DRAFT' && canManage && (
              <button className="btn btn-sm btn-primary" onClick={() => setModal('sign')} disabled={busy}>
                <Icon name="draw" size={15} style={{ marginRight: 4 }} />
                Отметить подписанным
              </button>
            )}
            {canEdit && (contract.status === 'DRAFT' ? canWrite : canManage) && (
              <button className="btn btn-sm btn-secondary" onClick={() => setModal('edit')}>Изменить</button>
            )}
            {contract.status === 'SIGNED' && canManage && (
              <button className="btn btn-sm btn-secondary" onClick={onComplete} disabled={busy}>Исполнен</button>
            )}
            {contract.status === 'SIGNED' && canManage && (
              <button className="btn btn-sm btn-danger" onClick={() => setModal('terminate')} disabled={busy}>Расторгнуть</button>
            )}
            {contract.status === 'DRAFT' && canManage && (
              <button className="btn btn-sm btn-danger" onClick={onDelete}>Удалить</button>
            )}
          </div>
        </div>
        <div className="card-body">
          <div className="detail-row"><div className="detail-label">Студент</div><div className="detail-value"><Link to={`/students/${contract.studentId}`}>{contract.student.fullName}</Link></div></div>
          <div className="detail-row"><div className="detail-label">Заявка-источник</div><div className="detail-value">{contract.application ? <Link to={`/applications/${contract.application.id}`}>{contract.application.fullName}</Link> : '—'}</div></div>
          <div className="detail-row"><div className="detail-label">Ответственный</div><div className="detail-value">{contract.manager?.fullName ?? '—'}</div></div>
          <div className="detail-row"><div className="detail-label">Сумма договора</div><div className="detail-value">{formatMoney(contract.amount)}</div></div>
          <div className="detail-row"><div className="detail-label">Подписан</div><div className="detail-value">{fmtDate(contract.signedAt)}{contract.signedBy ? ` · ${contract.signedBy.fullName}` : ''}</div></div>
          {contract.status === 'TERMINATED' && (
            <div className="detail-row"><div className="detail-label">Расторгнут</div><div className="detail-value">{fmtDate(contract.terminatedAt)}{contract.terminatedBy ? ` · ${contract.terminatedBy.fullName}` : ''} — {contract.terminationReason}</div></div>
          )}
          <div className="detail-row"><div className="detail-label">Переезд (веха KPI)</div><div className="detail-value">{fmtDate(contract.relocatedAt)}</div></div>
          <div className="detail-row"><div className="detail-label">Примечание</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{contract.note || '—'}</div></div>
          <div className="detail-row"><div className="detail-label">Создан</div><div className="detail-value">{fmtDateTime(contract.createdAt)}{contract.createdBy ? ` · ${contract.createdBy.fullName}` : ''}</div></div>

          <div className="payments-block-title">Связь с графиком платежей</div>
          {schedule.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}>У студента ещё не заполнен график платежей</div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Этап</th><th>План</th><th>Срок</th><th>Привязка</th></tr>
                  </thead>
                  <tbody>
                    {schedule.map((r) => (
                      <tr key={r.id} style={{ cursor: 'default' }}>
                        <td>{r.stage}</td>
                        <td data-label="План">{formatMoney(r.plannedAmount)}</td>
                        <td data-label="Срок">{r.dueDate ? new Date(r.dueDate).toLocaleDateString('ru-RU') : '—'}</td>
                        <td data-label="Привязка">
                          {r.contractId === contract.id ? (
                            <span className="badge badge-success">Этот договор</span>
                          ) : r.contractId ? (
                            <span className="badge badge-gray">Другой договор</span>
                          ) : (
                            <span className="badge badge-warning">Не привязано</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="receipt-dropzone-hint" style={{ marginTop: 10 }}>
                Привязано к этому договору: {linked.length} из {schedule.length} строк графика.
                {otherContract.length > 0 && ` К другим договорам: ${otherContract.length}.`}
              </div>
              {(contract.status === 'SIGNED' || contract.status === 'COMPLETED') && canManage && unlinked.length > 0 && (
                <button className="btn btn-sm btn-secondary" style={{ marginTop: 10 }} onClick={onLinkPayments} disabled={busy}>
                  <Icon name="link" size={15} style={{ marginRight: 4 }} />
                  Привязать неразмеченные платежи и график к этому договору
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {modal === 'edit' && (
          <ContractFormModal
            key="edit"
            studentId={contract.studentId}
            applications={(student?.applications || []).map((a) => ({ id: a.id, fullName: a.fullName, status: a.status }))}
            contract={contract}
            onClose={() => setModal(null)}
            onSaved={reload}
          />
        )}
        {modal === 'sign' && (
          <SignDatePrompt key="sign" onCancel={() => setModal(null)} onConfirm={onSign} />
        )}
        {modal === 'terminate' && (
          <PaymentReasonPrompt
            key="terminate"
            title="Расторгнуть договор"
            message="Действие необратимо переводит договор в состояние «Расторгнут». Возврат бонуса менеджеру оформляется отдельной корректировкой в расчётном листе."
            confirmText="Расторгнуть"
            danger
            onCancel={() => setModal(null)}
            onConfirm={onTerminate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
