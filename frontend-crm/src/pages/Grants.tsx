import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  GRANT_INTAKE_LABEL,
  GRANT_STATUS_BADGE,
  GRANT_STATUS_LABEL,
  advanceGrant,
  grantStats,
  listGrants,
  ordinalShortRu,
  type GrantIntake,
  type GrantStats,
  type GrantStatus,
  type StudentGrant,
} from '../api/grants';
import { listUsers } from '../api/users';
import type { User } from '../api/types';
import { isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { useUrlFilter } from '../hooks/useUrlFilter';
import Pagination from '../components/Pagination';
import Icon from '../Icon';
import { fadeUp, staggerContainer } from '../motion';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: GrantStatus[] = ['ACTIVE', 'SUSPENDED', 'COMPLETED', 'TERMINATED'];
const INTAKE_OPTIONS: GrantIntake[] = ['SEPTEMBER', 'FEBRUARY', 'OTHER'];

/**
 * ТЗ 4 — «Реестр студентов с двойным грантом». Отдельный раздел, а не только
 * карточка внутри студента: управленческий вопрос звучит «кому продлевать в
 * ближайший месяц», и ответ на него невозможно получить, обходя карточки
 * студентов по одной. Бэкенд (GET /grants, GET /grants/stats) отдавал эти
 * данные с волны 4, но экрана для них не было.
 *
 * Видимость режется внутри GrantsService по владению студентом (та же формула
 * canAccessStudentRecord, что у заявок и финансов), поэтому отдельный
 * ProtectedRoute с ролями здесь не нужен — менеджер видит свой срез реестра.
 */
export default function Grants() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isAdmin = isPrivileged(me?.role);

  const defaults = useMemo(
    () => ({
      search: '',
      status: '',
      intake: '',
      manager: '',
      // 'multi' — только многолетние (реестр «двойных» из ТЗ, дефолт),
      // 'all' — включая разовые гранты на один год.
      scope: 'multi',
      // Пусто = без ограничения по сроку; '30' | '60' | '90' — «продлевать в
      // ближайшие N дней», главный рабочий фильтр раздела.
      due: '',
      page: '1',
    }),
    [],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const status = filters.status as GrantStatus | '';
  const intake = filters.intake as GrantIntake | '';
  const manager = filters.manager;
  const scope = filters.scope as 'multi' | 'all';
  const due = filters.due;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<StudentGrant[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<GrantStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Счётчик поколений запросов списка — тот же приём, что в Students.tsx и
  // Applications.tsx. debounce ниже откладывает СТАРТ запроса, но уже улетевший
  // не отменяет: при быстром наборе медленный ответ по «Ива» приходил после
  // быстрого по «Иванов» и перерисовывал таблицу чужими грантами, а пагинация
  // считалась по чужому total — то есть сервер находил нужное, а экран это
  // молча затирал. Ответ с устаревшим номером отбрасываем; это же снимает
  // гонку с realtime-перезагрузкой по 'grant:updated'.
  const reqRef = useRef(0);

  const load = () => {
    const my = ++reqRef.current;
    setLoading(true);
    listGrants({
      multiOnly: scope === 'multi',
      status: status || undefined,
      intake: intake || undefined,
      managerId: manager || undefined,
      search: search || undefined,
      dueInDays: due ? parseInt(due, 10) : undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        if (my !== reqRef.current) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        if (my !== reqRef.current) return;
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (my !== reqRef.current) return;
        setLoading(false);
      });
  };

  const loadStats = () => {
    grantStats().then(setStats).catch(() => setStats(null));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, intake, manager, scope, due, page]);

  useEffect(loadStats, []);

  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  // Схлопываем поток grant:updated в одну перезагрузку — тот же приём, что в
  // Applications.tsx: при массовом переводе на следующий год событий много.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    'grant:updated': () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        load();
        loadStats();
      }, 600);
    },
  });

  const onFilterChange = (key: keyof typeof defaults, value: string) => {
    setFilters({ [key]: value, page: '1' });
  };

  /** Дней до старта следующего учебного года; null — плановой даты нет. */
  const daysUntil = (iso: string | null): number | null => {
    if (!iso) return null;
    const diff = new Date(iso).getTime() - Date.now();
    return Math.ceil(diff / (24 * 60 * 60 * 1000));
  };

  const onAdvance = async (g: StudentGrant, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = g.currentYear + 1;
    const ok = await confirm({
      title: 'Перевести на следующий год',
      message:
        `${g.student?.fullName ?? 'Студент'}: перевести грант на ${ordinalShortRu(next)} год обучения из ${g.totalYears}? ` +
        'Подтверждайте только после того, как вуз действительно продлил грант — CRM не имеет права записать факт, которого не было.',
      confirmText: 'Перевести',
    });
    if (!ok) return;
    setBusyId(g.id);
    try {
      await advanceGrant(g.id);
      toast('Грант переведён на следующий год', 'success');
      load();
      loadStats();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Не удалось перевести грант', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const statCards = stats
    ? [
        { label: 'Всего в реестре', value: stats.total, color: '#3b82f6', bg: '#eff6ff', icon: 'workspace_premium' },
        { label: 'Двойных (2+ года)', value: stats.multi, color: '#8b5cf6', bg: '#f5f3ff', icon: 'auto_awesome' },
        { label: 'Действующих', value: stats.activeThisYear, color: '#10b981', bg: '#ecfdf5', icon: 'verified' },
        { label: 'Продлевать ≤ 60 дней', value: stats.dueSoon60, color: '#f59e0b', bg: '#fffbeb', icon: 'event_upcoming' },
        { label: 'Без менеджера', value: stats.withoutManager, color: '#d52b2b', bg: '#fff0f0', icon: 'person_off' },
      ]
    : [];

  return (
    <div>
      {stats && (
        <motion.div className="stats-grid" variants={staggerContainer} initial="hidden" animate="show">
          {statCards.map((c) => (
            <motion.div key={c.label} className="stat-card" variants={fadeUp}>
              <div className="stat-icon-row">
                <div>
                  <div className="stat-label">{c.label}</div>
                  <div className="stat-value" style={{ color: c.color }}>{c.value}</div>
                </div>
                <div className="stat-icon" style={{ background: c.bg, color: c.color }}>
                  <Icon name={c.icon} size={24} />
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="card-header">
          <h2 className="card-title">Реестр грантов</h2>
          <div className="scope-switch">
            <button
              className={`scope-btn${scope === 'multi' ? ' active' : ''}`}
              onClick={() => onFilterChange('scope', 'multi')}
              title="Гранты, пролонгированные на 2-й и последующие годы — реестр из раздела 4 ТЗ"
            >
              <Icon name="auto_awesome" size={16} />
              Двойные
            </button>
            <button
              className={`scope-btn${scope === 'all' ? ' active' : ''}`}
              onClick={() => onFilterChange('scope', 'all')}
              title="Включая разовые гранты на один год"
            >
              <Icon name="view_list" size={16} />
              Все
            </button>
          </div>
        </div>

        <div className="card-body">
          <div className="filters">
            {/* ТЗ v3 раздел 1. grants.service.findAll ищет по ФИО студента и по
                Student.phoneSearch (обе формы номера — с кодом страны и без,
                см. buildPhoneSearch), отсюда «в любом формате».
                Название гранта и вуз сервис НЕ ищет, хотя обе колонки видны в
                таблице — не дописывайте их в подпись, пока этого нет в запросе. */}
            <input
              placeholder="Поиск по ФИО или телефону студента в любом формате..."
              value={search}
              onChange={(e) => onFilterChange('search', e.target.value)}
              title="Телефон можно вводить в любом виде: +992 90 123-45-67, 992901234567 или 901234567"
            />
            <select value={due} onChange={(e) => onFilterChange('due', e.target.value)} title="Когда стартует следующий учебный год">
              <option value="">Любой срок продления</option>
              <option value="30">Продлевать ≤ 30 дней</option>
              <option value="60">Продлевать ≤ 60 дней</option>
              <option value="90">Продлевать ≤ 90 дней</option>
            </select>
            <select value={status} onChange={(e) => onFilterChange('status', e.target.value)}>
              <option value="">Все статусы</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{GRANT_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select value={intake} onChange={(e) => onFilterChange('intake', e.target.value)}>
              <option value="">Любой набор</option>
              {INTAKE_OPTIONS.map((i) => (
                <option key={i} value={i}>{GRANT_INTAKE_LABEL[i]}</option>
              ))}
            </select>
            {isAdmin && (
              <select value={manager} onChange={(e) => onFilterChange('manager', e.target.value)} title="Ответственный менеджер студента">
                <option value="">Все менеджеры</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            )}
          </div>

          <>
            {loading ? (
              <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Загрузка...
              </motion.div>
            ) : total === 0 ? (
              <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="empty-icon"><Icon name="workspace_premium" size={48} /></div>
                {scope === 'multi'
                  ? 'Двойных грантов пока нет. Грант заводится в карточке студента — блок «Грант».'
                  : 'Грантов не найдено'}
              </motion.div>
            ) : (
              <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Студент</th>
                      <th>Грант</th>
                      <th>Год обучения</th>
                      <th>Набор</th>
                      <th>Следующий год</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((g) => {
                      const left = daysUntil(g.nextYearStartsAt);
                      const soon = left !== null && left <= 60;
                      const overdue = left !== null && left < 0;
                      const canAdvance = g.status === 'ACTIVE' && g.currentYear < g.totalYears;
                      return (
                        <tr
                          key={g.id}
                          onClick={() => g.student && navigate(`/students/${g.student.id}`)}
                          style={{ cursor: g.student ? 'pointer' : 'default' }}
                        >
                          <td>
                            <strong>{g.student?.fullName ?? '—'}</strong>
                            {g.student && !g.student.managerId && !g.student.chinaManagerId && (
                              <span className="badge badge-danger" style={{ marginLeft: 6 }} title="Напоминание уйдёт Основателю — назначьте ответственного">
                                Без менеджера
                              </span>
                            )}
                          </td>
                          <td data-label="Грант">
                            <div>{g.name || '—'}</div>
                            {g.university && (
                              <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{g.university}</div>
                            )}
                          </td>
                          <td data-label="Год обучения">
                            <strong>{ordinalShortRu(g.currentYear)}</strong> из {g.totalYears}
                          </td>
                          <td data-label="Набор">{GRANT_INTAKE_LABEL[g.intake]}</td>
                          <td data-label="Следующий год">
                            {g.nextYearStartsAt ? (
                              <div>
                                <div>{new Date(g.nextYearStartsAt).toLocaleDateString('ru-RU')}</div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: overdue ? 'var(--danger)' : soon ? 'var(--warning)' : 'var(--text-soft)',
                                  }}
                                >
                                  {overdue ? `просрочено на ${Math.abs(left as number)} дн.` : `через ${left} дн.`}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-soft)' }}>—</span>
                            )}
                          </td>
                          <td data-label="Статус">
                            <span className={`badge ${GRANT_STATUS_BADGE[g.status]}`}>{GRANT_STATUS_LABEL[g.status]}</span>
                          </td>
                          <td data-label="Действия" onClick={(e) => e.stopPropagation()}>
                            {canAdvance && (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={(e) => onAdvance(g, e)}
                                disabled={busyId === g.id}
                                title="Отметить, что вуз продлил грант на следующий учебный год"
                              >
                                {busyId === g.id ? '...' : 'На следующий год'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
    </div>
  );
}
