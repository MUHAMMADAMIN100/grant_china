import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { Contract, ContractStatus, User } from '../api/types';
import { CONTRACT_STATUS_LABEL, isPrivileged } from '../api/types';
import { contractStats, listContracts } from '../api/contracts';
import type { ContractStats } from '../api/contracts';
import { listUsers } from '../api/users';
import { useAuth } from '../store/auth';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { formatMoney } from '../utils/money';
import { toPeriodRange } from '../utils/datetime';
import Pagination from '../components/Pagination';
import ContractStatusBadge from '../components/ContractStatusBadge';
import StatTile, { type StatDetail } from '../components/StatTile';
import { staggerContainer } from '../motion';
import Icon from '../Icon';

const PAGE_SIZE = 20;

/**
 * Раздел 5 ТЗ (волна 6) — реестр договоров. РЕШЕНИЕ ЗАКАЗЧИКА: договор —
 * отдельная сущность. Создание доступно только из карточки студента/заявки
 * (там уже есть контекст studentId) — эта страница только просматривает и
 * фильтрует, как /finance для платежей.
 *
 * Поэтому ТЗ v3 раздел 4 (критерий приёмки №4, «Администратор — финансы
 * только на чтение») здесь ничего не ограничивает: страница не мутирует
 * ничего, а isPrivileged ниже — это НЕ финансовое право, а видимость чужих
 * записей: только FOUNDER и ADMIN видят договоры всех менеджеров, и только им
 * бэкенд отдаёт GET /users (@Roles(FOUNDER, ADMIN)) для фильтра по
 * ответственному. Менять эту проверку на canWriteFinance/canManageFinance
 * нельзя — иначе Администратор потеряет положенный ему обзор.
 */
export default function Contracts() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const isPriv = isPrivileged(me?.role);

  const defaults = useMemo(
    () => ({ status: '', manager: '', from: '', to: '', search: '', page: '1' }),
    [],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const status = filters.status as ContractStatus | '';
  const manager = filters.manager;
  const from = filters.from;
  const to = filters.to;
  const search = filters.search;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Contract[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ContractStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Счётчик поколений запросов списка. debounce откладывает СТАРТ, но уже
  // улетевший запрос не отменяет: медленный ответ по прошлому фильтру
  // приходил после свежего и перерисовывал таблицу чужими договорами, а
  // пагинация считалась по чужому total. Ответ с устаревшим номером
  // отбрасываем — это же снимает гонку с realtime-перезагрузкой.
  const reqRef = useRef(0);

  useEffect(() => {
    if (isPriv) listUsers().then(setUsers).catch(() => {});
  }, [isPriv]);

  const loadStats = () => {
    contractStats().then(setStats).catch(() => {});
  };

  const load = () => {
    const my = ++reqRef.current;
    setLoading(true);
    setError(null);
    listContracts({
      status: status || undefined,
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
        // фильтра, а сброшенный loading выдал бы её за успешно применённый.
        // Пустая таблица без баннера читалась бы как «ничего не найдено».
        setItems([]);
        setTotal(0);
        setError(e?.response?.data?.message || 'Не удалось загрузить список договоров');
      })
      .finally(() => {
        if (my !== reqRef.current) return;
        setLoading(false);
      });
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, manager, from, to, search, page]);

  useEffect(loadStats, []);

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => { reloadTimerRef.current = null; load(); loadStats(); }, 500);
  };
  useRealtime({ 'contract:updated': scheduleReload });

  const onFilterChange = (key: keyof typeof defaults, value: string) => {
    setFilters({ [key]: value, page: '1' });
  };

  /**
   * Расшифровки плиток. Сводка приходит БЕЗ фильтра периода (contracts.stats
   * считает по всему реестру), поэтому ссылки ведут в список только со
   * статусом — даты из текущего фильтра в них не переносятся, иначе число
   * строк в списке не совпало бы с цифрой на плитке.
   */
  const share = (n: number): number | undefined =>
    stats && stats.total > 0 ? n / stats.total : undefined;
  const SCOPE_NOTE = isPriv
    ? 'Считаются договоры всех менеджеров. Удалённые не входят.'
    : 'Считаются только договоры ваших студентов. Удалённые не входят.';

  const statCards: Array<{
    label: string;
    value: number;
    color: string;
    bg: string;
    icon: string;
    detail?: StatDetail;
  }> = stats
    ? [
        {
          label: 'Всего',
          value: stats.total,
          color: '#3b82f6',
          bg: '#eff6ff',
          icon: 'description',
          detail: {
            meaning: 'Все договоры в реестре, на любой стадии — от черновика до расторжения.',
            period: 'Текущее состояние реестра, а не за период.',
            formula: SCOPE_NOTE,
            rowsTitle: 'По статусам — нажмите, чтобы открыть список',
            rows: [
              { label: CONTRACT_STATUS_LABEL.DRAFT, value: String(stats.draft), to: '/contracts?status=DRAFT', share: share(stats.draft) },
              { label: CONTRACT_STATUS_LABEL.SIGNED, value: String(stats.signed), to: '/contracts?status=SIGNED', share: share(stats.signed) },
              { label: CONTRACT_STATUS_LABEL.COMPLETED, value: String(stats.completed), to: '/contracts?status=COMPLETED', share: share(stats.completed) },
              { label: CONTRACT_STATUS_LABEL.TERMINATED, value: String(stats.terminated), to: '/contracts?status=TERMINATED', share: share(stats.terminated) },
            ],
            link: { to: '/contracts', label: 'Открыть весь реестр' },
          },
        },
        {
          label: 'Черновики',
          value: stats.draft,
          color: '#5b6478',
          bg: '#f5f7fb',
          icon: 'edit_note',
          detail: {
            meaning:
              'Договоры, которые готовятся, но ещё не подписаны. В KPI и зарплате менеджера они не участвуют — бонус даёт только подписанный договор.',
            period: 'Текущее состояние реестра, а не за период.',
            formula: SCOPE_NOTE,
            link: { to: '/contracts?status=DRAFT', label: 'Открыть черновики' },
          },
        },
        {
          label: 'Подписаны',
          value: stats.signed,
          color: '#10b981',
          bg: '#ecfdf5',
          icon: 'verified',
          detail: {
            meaning:
              'Действующие договоры. Единственный статус, который даёт менеджеру конверсию и бонус, и по которому идёт график оплат.',
            period: 'Текущее состояние реестра, а не за период.',
            formula: `${SCOPE_NOTE} Дата подписания у такого договора проставлена всегда.`,
            link: { to: '/contracts?status=SIGNED', label: 'Открыть подписанные' },
          },
        },
        {
          label: 'Расторгнуты',
          value: stats.terminated,
          color: '#ef4444',
          bg: '#fef2f2',
          icon: 'cancel',
          detail: {
            meaning: 'Договоры, разорванные досрочно. Статус конечный: обратно в «Подписан» договор не возвращается.',
            period: 'Текущее состояние реестра, а не за период.',
            formula: `${SCOPE_NOTE} У каждого расторжения записана причина — она видна в карточке договора.`,
            link: { to: '/contracts?status=TERMINATED', label: 'Открыть расторгнутые' },
          },
        },
        {
          label: 'Исполнены',
          value: stats.completed,
          color: '#3b82f6',
          bg: '#eff6ff',
          icon: 'task_alt',
          detail: {
            meaning: 'Договоры, отработанные до конца: обязательства закрыты с обеих сторон. Статус конечный.',
            period: 'Текущее состояние реестра, а не за период.',
            formula: SCOPE_NOTE,
            link: { to: '/contracts?status=COMPLETED', label: 'Открыть исполненные' },
          },
        },
      ]
    : [];

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="card-header">
        <h2 className="card-title">Договоры</h2>
      </div>
      <div className="card-body">
        {stats && (
          <motion.div
            className="stats-grid"
            style={{ marginBottom: 20 }}
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            {statCards.map((c) => (
              <StatTile
                key={c.label}
                label={c.label}
                value={c.value}
                color={c.color}
                bg={c.bg}
                icon={c.icon}
                valueFontSize={26}
                detail={c.detail}
              />
            ))}
          </motion.div>
        )}

        <div className="filters">
          {/* ТЗ v3 раздел 1. contracts.service.findAll ищет по ФИО студента и
              по Student.phoneSearch, где каждый номер лежит в двух формах —
              с кодом страны и без (buildPhoneSearch), отсюда «в любом формате».
              Номер договора («ДГ-2026-0001») сервис НЕ ищет, поэтому в подписи
              его нет: пообещать номер и вернуть пустую таблицу хуже, чем не
              обещать. Появится поиск по number — расширяйте подпись здесь. */}
          <input
            placeholder="Поиск по ФИО или телефону студента в любом формате..."
            value={search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            title="Телефон можно вводить в любом виде: +992 90 123-45-67, 992901234567 или 901234567"
          />
          <select value={status} onChange={(e) => onFilterChange('status', e.target.value)}>
            <option value="">Все статусы</option>
            {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {isPriv && (
            <select value={manager} onChange={(e) => onFilterChange('manager', e.target.value)} title="Фильтр по ответственному">
              <option value="">Все ответственные</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          )}
          <input type="date" value={from} onChange={(e) => onFilterChange('from', e.target.value)} title="Подписан от" />
          <input type="date" value={to} onChange={(e) => onFilterChange('to', e.target.value)} title="Подписан до" />
        </div>

        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        <>
          {loading ? (
            <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : total === 0 ? (
            <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="empty-icon"><Icon name="description" size={48} /></div>
              Договоров не найдено
            </motion.div>
          ) : (
            <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Номер</th><th>Студент</th><th>Ответственный</th><th>Сумма</th><th>Статус</th><th>Подписан</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} onClick={() => navigate(`/contracts/${c.id}`)} style={{ cursor: 'pointer' }}>
                      <td><strong>{c.number}</strong></td>
                      <td data-label="Студент">{c.student.fullName}</td>
                      <td data-label="Ответственный">{c.manager?.fullName ?? '—'}</td>
                      <td data-label="Сумма">{formatMoney(c.amount)}</td>
                      <td data-label="Статус"><ContractStatusBadge status={c.status} /></td>
                      <td data-label="Подписан">{c.signedAt ? new Date(c.signedAt).toLocaleDateString('ru-RU') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          )}
        </>

        {!loading && (
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={(p) => setFilter('page', String(p))} />
        )}
      </div>
    </motion.div>
  );
}
