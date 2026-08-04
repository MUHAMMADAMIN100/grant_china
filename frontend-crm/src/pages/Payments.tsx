import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { Payment, PaymentMethod, PaymentPurpose, PaymentStage, PaymentStatus, User } from '../api/types';
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_PURPOSE_LABEL,
  PAYMENT_STAGE_LABEL,
  PAYMENT_STATUS_LABEL,
  SCHEDULE_PAYMENT_STAGES,
  isFounder,
  isPrivileged,
} from '../api/types';
import { approvePayment, listPayments, listPendingPayments, pendingPaymentsCount, rejectPayment } from '../api/payments';
import { listUsers } from '../api/users';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { formatMoney } from '../utils/money';
import { buildFileUrl } from '../utils/fileUrl';
import Pagination from '../components/Pagination';
import PaymentStatusBadge from '../components/PaymentStatusBadge';
import PaymentReasonPrompt from '../components/PaymentReasonPrompt';
import Icon from '../Icon';
import { toPeriodRange } from '../utils/datetime';

const PAGE_SIZE = 10;
const ALL_STAGES: PaymentStage[] = [...SCHEDULE_PAYMENT_STAGES, 'LIVING_EXPENSES'];

export default function Payments() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  /**
   * ВНИМАНИЕ: isPriv здесь — про ОБЪЁМ ВИДИМОСТИ, а не про право записи.
   * Он открывает вкладку «На одобрении», фильтр по менеджеру и выборку по всем
   * студентам; на бэкенде это GET /payments/pending и /pending/count с
   * @Roles(FOUNDER, ADMIN). Именно так и должно быть по ТЗ v3 раздел 4,
   * критерий приёмки №4: Администратор финансы ВИДИТ, но не меняет — поэтому
   * менять isPriv на canWriteFinance здесь нельзя, иначе Администратор лишится
   * положенного ему просмотра очереди.
   *
   * Все действия записи на этой странице (Одобрить/Отклонить) закрыты isFdr —
   * вместе со столбцом «Действия», чтобы у Администратора не оставалось пустой
   * колонки в таблице.
   */
  const isPriv = isPrivileged(me?.role);
  const isFdr = isFounder(me?.role);

  const defaults = useMemo(
    () => ({
      tab: 'all',
      status: '',
      stage: '',
      purpose: '',
      method: '',
      manager: '',
      from: '',
      to: '',
      search: '',
      page: '1',
      pendingPage: '1',
    }),
    [],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const tab = (isPriv ? filters.tab : 'all') as 'all' | 'pending';
  const status = filters.status as PaymentStatus | '';
  const stage = filters.stage as PaymentStage | '';
  const purpose = filters.purpose as PaymentPurpose | '';
  const method = filters.method as PaymentMethod | '';
  const manager = filters.manager;
  const from = filters.from;
  const to = filters.to;
  const search = filters.search;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const pendingPage = Math.max(1, parseInt(filters.pendingPage, 10) || 1);

  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingItems, setPendingItems] = useState<Payment[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingTotalAmount, setPendingTotalAmount] = useState('0.00');
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // Счётчики поколений запросов (свой на каждый список). debounce откладывает
  // СТАРТ, но уже улетевший запрос не отменяет: медленный ответ по прошлому
  // фильтру приходил после свежего и перерисовывал таблицу чужими платежами,
  // а пагинация считалась по чужому total. Ответ с устаревшим номером
  // отбрасываем — это же снимает гонку с realtime-перезагрузкой.
  const reqRef = useRef(0);
  const pendingReqRef = useRef(0);

  const [users, setUsers] = useState<User[]>([]);
  const [rejectTarget, setRejectTarget] = useState<Payment | null>(null);

  useEffect(() => {
    if (isPriv) listUsers().then(setUsers).catch(() => {});
  }, [isPriv]);

  // Счётчик для подписи вкладки виден сразу, ещё до её открытия — иначе
  // «На одобрении» без числа выглядит так, будто очередь пуста.
  useEffect(() => {
    if (!isPriv) return;
    pendingPaymentsCount().then((r) => setPendingTotal(r.count)).catch(() => {});
  }, [isPriv]);

  const loadAll = () => {
    const my = ++reqRef.current;
    setLoading(true);
    setError(null);
    listPayments({
      status: status || undefined,
      stage: stage || undefined,
      purpose: purpose || undefined,
      method: method || undefined,
      managerId: isPriv ? manager || undefined : undefined,
      ...toPeriodRange(from, to),
      search: search || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        if (my !== reqRef.current) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e: any) => {
        if (my !== reqRef.current) return;
        // Без сброса items/total на экране осталась бы выборка ПРОШЛОГО
        // фильтра: Основатель фильтрует «Наличные», запрос падает, а на экране
        // остаются безналичные платежи — и он делает по ним выводы о кассе.
        setItems([]);
        setTotal(0);
        setError(e?.response?.data?.message || 'Не удалось загрузить список платежей');
      })
      .finally(() => {
        if (my !== reqRef.current) return;
        setLoading(false);
      });
  };

  const loadPending = () => {
    if (!isPriv) return;
    const my = ++pendingReqRef.current;
    setPendingLoading(true);
    setPendingError(null);
    listPendingPayments({ page: pendingPage, pageSize: PAGE_SIZE })
      .then((res) => {
        if (my !== pendingReqRef.current) return;
        setPendingItems(res.items);
        setPendingTotal(res.total);
        setPendingTotalAmount(res.totalAmount);
      })
      .catch((e: any) => {
        if (my !== pendingReqRef.current) return;
        // Очередь на одобрение — деньги: показать устаревшую или выдать отказ
        // за «очередь пуста» одинаково недопустимо.
        setPendingItems([]);
        setPendingTotal(0);
        setPendingTotalAmount('0.00');
        setPendingError(e?.response?.data?.message || 'Не удалось загрузить очередь на одобрение');
      })
      .finally(() => {
        if (my !== pendingReqRef.current) return;
        setPendingLoading(false);
      });
  };

  useEffect(() => {
    if (tab !== 'all') return;
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status, stage, purpose, method, manager, from, to, search, page]);

  useEffect(() => {
    if (tab !== 'pending') return;
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pendingPage, isPriv]);

  // Realtime debounce — схлопываем пачку событий за 500мс в один reload,
  // как на странице Students.tsx.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      if (tab === 'pending') loadPending(); else loadAll();
    }, 500);
  };
  useRealtime({
    'payment:created': scheduleReload,
    'payment:updated': scheduleReload,
    'payment:submitted': scheduleReload,
    'payment:recalled': scheduleReload,
    'payment:approved': scheduleReload,
    'payment:rejected': scheduleReload,
    'payment:voided': scheduleReload,
    'payment:deleted': scheduleReload,
  });

  const onFilterChange = (key: keyof typeof defaults, value: string) => {
    setFilters({ [key]: value, page: '1' });
  };

  const onTabChange = (next: 'all' | 'pending') => {
    setFilter('tab', next);
  };

  const handleApprove = async (p: Payment) => {
    const ok = await confirm({
      title: 'Одобрить платёж',
      message: `Подтвердите фактическое поступление ${formatMoney(p.amount)} по студенту «${p.student?.fullName ?? ''}». После одобрения платёж будет считаться проведённым.`,
      confirmText: 'Одобрить',
    });
    if (!ok) return;
    try {
      await approvePayment(p.id, p.updatedAt);
      toast('Платёж одобрен', 'success');
      loadPending();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка одобрения платежа', 'error');
    }
  };

  const onConfirmReject = async (reason: string) => {
    if (!rejectTarget) return;
    try {
      await rejectPayment(rejectTarget.id, reason);
      toast('Платёж отклонён', 'success');
      setRejectTarget(null);
      loadPending();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка отклонения платежа', 'error');
    }
  };

  const firstReceiptUrl = (p: Payment) => (p.receipts[0] ? buildFileUrl(p.receipts[0].url) : null);

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="card-header">
        <h2 className="card-title">Финансы</h2>
        {isPriv && (
          <div className="scope-switch">
            <button className={`scope-btn${tab === 'all' ? ' active' : ''}`} onClick={() => onTabChange('all')}>
              <Icon name="receipt_long" size={16} />
              Все платежи
            </button>
            <button className={`scope-btn${tab === 'pending' ? ' active' : ''}`} onClick={() => onTabChange('pending')}>
              <Icon name="pending_actions" size={16} />
              На одобрении{pendingTotal > 0 ? ` (${pendingTotal})` : ''}
            </button>
          </div>
        )}
      </div>

      <div className="card-body">
        {tab === 'all' ? (
          <>
            <div className="filters">
              <input
                placeholder="Поиск: студент или номер квитанции..."
                value={search}
                onChange={(e) => onFilterChange('search', e.target.value)}
              />
              <select value={status} onChange={(e) => onFilterChange('status', e.target.value)}>
                <option value="">Все статусы</option>
                {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select value={stage} onChange={(e) => onFilterChange('stage', e.target.value)}>
                <option value="">Все этапы</option>
                {ALL_STAGES.map((s) => (
                  <option key={s} value={s}>{PAYMENT_STAGE_LABEL[s]}</option>
                ))}
              </select>
              <select value={purpose} onChange={(e) => onFilterChange('purpose', e.target.value)}>
                <option value="">Все назначения</option>
                {Object.entries(PAYMENT_PURPOSE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select value={method} onChange={(e) => onFilterChange('method', e.target.value)}>
                <option value="">Все способы</option>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              {isPriv && (
                <select value={manager} onChange={(e) => onFilterChange('manager', e.target.value)} title="Фильтр по менеджеру">
                  <option value="">Все менеджеры</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName}</option>
                  ))}
                </select>
              )}
              <input type="date" value={from} onChange={(e) => onFilterChange('from', e.target.value)} title="Дата поступления от" />
              <input type="date" value={to} onChange={(e) => onFilterChange('to', e.target.value)} title="Дата поступления до" />
            </div>

            {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

            <AnimatePresence mode="wait">
              {loading ? (
                <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Загрузка...
                </motion.div>
              ) : total === 0 ? (
                <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="empty-icon"><Icon name="payments" size={48} /></div>
                  Платежей не найдено
                </motion.div>
              ) : (
                <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Студент</th><th>Этап</th><th>Назначение</th><th>Способ</th><th>Сумма</th><th>Дата</th><th>Статус</th><th>Кто внёс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => (
                        <tr key={p.id} onClick={() => navigate(`/students/${p.studentId}`)} style={{ cursor: 'pointer' }}>
                          <td><strong>{p.student?.fullName || '—'}</strong></td>
                          <td data-label="Этап">{PAYMENT_STAGE_LABEL[p.stage]}</td>
                          <td data-label="Назначение">{PAYMENT_PURPOSE_LABEL[p.purpose]}</td>
                          <td data-label="Способ">{PAYMENT_METHOD_LABEL[p.method]}</td>
                          <td data-label="Сумма">{formatMoney(p.amount)}</td>
                          <td data-label="Дата">{new Date(p.paidAt).toLocaleDateString('ru-RU')}</td>
                          <td data-label="Статус"><PaymentStatusBadge status={p.status} /></td>
                          <td data-label="Кто внёс">{p.createdBy?.fullName || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </motion.div>
              )}
            </AnimatePresence>

            {!loading && (
              <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={(p) => setFilter('page', String(p))} />
            )}
          </>
        ) : (
          <>
            {pendingTotal > 0 && (
              <div className="pending-summary-banner">
                <Icon name="pending_actions" size={22} />
                <div>
                  К акцепту: <b>{pendingTotal}</b> {pendingTotal === 1 ? 'платёж' : 'платежей'} на сумму <b>{formatMoney(pendingTotalAmount)}</b>
                </div>
              </div>
            )}

            {pendingError && <div className="error-banner" style={{ marginBottom: 12 }}>{pendingError}</div>}

            <AnimatePresence mode="wait">
              {pendingLoading ? (
                <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Загрузка...
                </motion.div>
              ) : pendingTotal === 0 ? (
                <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="empty-icon"><Icon name="task_alt" size={48} /></div>
                  Очередь на одобрение пуста
                </motion.div>
              ) : (
                <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        {/* ТЗ 1.1 Double Check: без даты поступления второй акт
                            проверки не ловит ошибку в paidAt, а по ней строится
                            вся отчётность и база премий. «Подано» — это про
                            момент подачи в очередь, не про приход денег. */}
                        <th>Студент</th><th>Этап</th><th>Назначение</th><th>Способ</th><th>Сумма</th><th>Дата поступления</th><th>Подано</th><th>Кем</th><th>Чек</th>
                        {isFdr && <th>Действия</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pendingItems.map((p) => {
                        const receiptUrl = firstReceiptUrl(p);
                        // Double Check (ТЗ 1.1): Основатель проверяет ЧУЖУЮ работу.
                        // Бэкенд (payments.service.approve) блокирует одобрение,
                        // если пользователь причастен к платежу — как автор ИЛИ
                        // как подавший. Фронт обязан отражать оба условия, иначе
                        // кнопка активна, а клик возвращает 409.
                        const submittedByMe = !!p.submittedById && p.submittedById === me?.id;
                        const createdByMe = !!p.createdById && p.createdById === me?.id;
                        const cannotApprove = submittedByMe || createdByMe;
                        const cannotApproveReason = createdByMe
                          ? 'Вы внесли этот платёж — одобрить должен другой пользователь'
                          : 'Вы подали этот платёж — одобрить должен другой пользователь';
                        return (
                          <tr key={p.id} onClick={() => navigate(`/students/${p.studentId}`)} style={{ cursor: 'pointer' }}>
                            <td><strong>{p.student?.fullName || '—'}</strong></td>
                            <td data-label="Этап">{PAYMENT_STAGE_LABEL[p.stage]}</td>
                            <td data-label="Назначение">{PAYMENT_PURPOSE_LABEL[p.purpose]}</td>
                            <td data-label="Способ">{PAYMENT_METHOD_LABEL[p.method]}</td>
                            <td data-label="Сумма">{formatMoney(p.amount)}</td>
                            <td data-label="Дата поступления">{new Date(p.paidAt).toLocaleDateString('ru-RU')}</td>
                            <td data-label="Подано">{p.submittedAt ? new Date(p.submittedAt).toLocaleString('ru-RU') : '—'}</td>
                            <td data-label="Кем">{p.submittedBy?.fullName || '—'}</td>
                            <td data-label="Чек">
                              {receiptUrl ? (
                                <a
                                  href={receiptUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="pending-receipt-thumb"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Открыть чек"
                                >
                                  <Icon name="receipt" size={18} />
                                </a>
                              ) : (
                                <span className="mgr-none">—</span>
                              )}
                            </td>
                            {isFdr && (
                              <td data-label="Действия" onClick={(e) => e.stopPropagation()}>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    className="btn btn-sm btn-primary"
                                    onClick={() => handleApprove(p)}
                                    disabled={cannotApprove}
                                    title={cannotApprove ? cannotApproveReason : undefined}
                                  >
                                    Одобрить
                                  </button>
                                  <button className="btn btn-sm btn-danger" onClick={() => setRejectTarget(p)}>
                                    Отклонить
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </motion.div>
              )}
            </AnimatePresence>

            {!pendingLoading && (
              <Pagination page={pendingPage} total={pendingTotal} pageSize={PAGE_SIZE} onChange={(p) => setFilter('pendingPage', String(p))} />
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {rejectTarget && (
          <PaymentReasonPrompt
            key="reject"
            title="Отклонить платёж"
            message="Причина обязательна — менеджер увидит её и сможет исправить данные."
            confirmText="Отклонить"
            danger
            onCancel={() => setRejectTarget(null)}
            onConfirm={onConfirmReject}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
