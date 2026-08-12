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

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="card-header">
        <h2 className="card-title">Договоры</h2>
      </div>
      <div className="card-body">
        {stats && (
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            {[
              { label: 'Всего', value: stats.total, color: '#3b82f6', bg: '#eff6ff', icon: 'description' },
              { label: 'Черновики', value: stats.draft, color: '#5b6478', bg: '#f5f7fb', icon: 'edit_note' },
              { label: 'Подписаны', value: stats.signed, color: '#10b981', bg: '#ecfdf5', icon: 'verified' },
              { label: 'Расторгнуты', value: stats.terminated, color: '#ef4444', bg: '#fef2f2', icon: 'cancel' },
              { label: 'Исполнены', value: stats.completed, color: '#3b82f6', bg: '#eff6ff', icon: 'task_alt' },
            ].map((c) => (
              <div key={c.label} className="stat-card">
                <div className="stat-icon-row">
                  <div>
                    <div className="stat-label">{c.label}</div>
                    <div className="stat-value" style={{ color: c.color, fontSize: 26 }}>{c.value}</div>
                  </div>
                  <div className="stat-icon" style={{ background: c.bg, color: c.color }}>
                    <Icon name={c.icon} size={22} />
                  </div>
                </div>
              </div>
            ))}
          </div>
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
