import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  applicationTabCounts,
  archiveApplication,
  clearRepeatApplication,
  listApplicationsPaged,
  unarchiveApplication,
  type ApplicationTabCounts,
} from '../api/applications';
import { listUsers } from '../api/users';
import type { Application, ApplicationStatus, ApplicationTab, Direction, User } from '../api/types';
import { DIRECTION_LABEL, LEAD_SOURCES, STATUS_BADGE, STATUS_LABEL, isPrivileged, leadSourceLabel } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import Icon from '../Icon';
import DirectionOptions from '../components/DirectionOptions';
import Pagination from '../components/Pagination';
import { useUrlFilter } from '../hooks/useUrlFilter';
import { toPeriodRange } from '../utils/datetime';

const PAGE_SIZE = 10;

const TAB_ORDER: ApplicationTab[] = ['all', 'new', 'in_work', 'archive'];
const TAB_LABEL: Record<ApplicationTab, string> = {
  all: 'Все',
  new: 'Новые',
  in_work: 'В работе',
  archive: 'Архив',
};
const TAB_TITLE: Record<ApplicationTab, string> = {
  all: 'Все заявки',
  new: 'Новые заявки — поступают автоматически с сайта и соцсетей',
  in_work: 'Заявки в работе',
  archive: 'Ранее зарегистрированные / Архив: повторные обращения и архивные лиды',
};
const TAB_ICON: Record<ApplicationTab, string> = {
  all: 'view_list',
  new: 'fiber_new',
  in_work: 'autorenew',
  archive: 'inventory_2',
};
const EMPTY_COUNTS: ApplicationTabCounts = { all: 0, new: 0, in_work: 0, archive: 0 };

export default function Applications() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const isAdmin = isPrivileged(me?.role);

  // Все фильтры хранятся в URL — при возврате назад/обновлении страницы
  // они автоматически восстанавливаются. Дефолт scope зависит от роли:
  // привилегированные видят 'all', сотрудники — 'mine'.
  const defaults = useMemo(
    () => ({
      search: '',
      status: '',
      direction: '',
      manager: '',
      scope: isAdmin ? 'all' : 'mine',
      tab: 'all',
      source: '',
      from: '',
      to: '',
      page: '1',
    }),
    [isAdmin],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const status = filters.status as ApplicationStatus | '';
  const direction = filters.direction as Direction | '';
  const manager = filters.manager;
  const scope = filters.scope as 'all' | 'mine';
  const tab = (filters.tab || 'all') as ApplicationTab;
  const source = filters.source;
  const from = filters.from;
  const to = filters.to;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabCounts, setTabCounts] = useState<ApplicationTabCounts>(EMPTY_COUNTS);

  // Счётчик поколений запросов списка. debounce откладывает СТАРТ, но уже
  // улетевший запрос не отменяет: медленный ответ по «Ива» приходил после
  // быстрого по «Иванов» и перерисовывал таблицу чужими заявками, а пагинация
  // считалась по чужому total. Ответ с устаревшим номером просто отбрасываем.
  const reqRef = useRef(0);

  // Общая часть параметров для списка и для счётчиков вкладок — без этого
  // они бы разъехались при правке только одного из двух мест (см. риск 6
  // проекта архитектора: список vs дашборд).
  const commonParams = () => ({
    search: search || undefined,
    status: status || undefined,
    direction: direction || undefined,
    mine: scope === 'mine',
    manager: manager || undefined,
    source: source || undefined,
    // ТЗ 3.1 — фильтр по датам. Обе границы строит toPeriodRange: голое
    // new Date('2026-07-01') парсится как UTC-полночь, а не как локальная,
    // и в Душанбе (UTC+5) нижняя граница уезжала на 5 часов вперёд —
    // заявки, созданные ночью первого дня периода, выпадали из выборки.
    ...toPeriodRange(from, to),
  });

  const load = () => {
    const my = ++reqRef.current;
    setLoading(true);
    setError(null);
    listApplicationsPaged({
      ...commonParams(),
      tab,
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
        setError(e?.response?.data?.message || 'Не удалось загрузить список заявок');
      })
      .finally(() => {
        if (my !== reqRef.current) return;
        setLoading(false);
      });
  };

  const loadCounts = () => {
    applicationTabCounts(commonParams())
      .then(setTabCounts)
      .catch(() => {});
  };

  // Debounce realtime: несколько событий за 500мс схлопываются в один load().
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      load();
      loadCounts();
    }, 500);
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, direction, scope, manager, source, from, to, tab, page]);

  // Счётчики вкладок НЕ зависят от tab/page — отдельный эффект, чтобы не
  // гонять лишний запрос при простом переключении страницы.
  useEffect(() => {
    const t = setTimeout(loadCounts, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, direction, scope, manager, source, from, to]);

  // При перезагрузке после realtime/удаления — если страница перешла
  // за пределы, сдвигаемся на ближайшую существующую.
  useEffect(() => {
    if (loading) return;
    if (total === 0) return;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) setFilter('page', String(totalPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, loading]);

  const pagedItems = items;

  // Список пользователей для фильтра по менеджерам — только админу
  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  useRealtime({
    'application:new': () => scheduleReload(),
    'application:updated': () => scheduleReload(),
    'application:deleted': () => scheduleReload(),
  });

  // При смене фильтра сбрасываем страницу на 1 — атомарно через setFilters,
  // иначе два setFilter подряд гонятся (второй перетирает первый).
  const onFilterChange = (
    key: 'search' | 'status' | 'direction' | 'manager' | 'scope' | 'source' | 'from' | 'to',
    value: string,
  ) => {
    setFilters({ [key]: value, page: '1' });
  };

  const onTabChange = (next: ApplicationTab) => {
    setFilters({ tab: next, page: '1' });
  };

  // Права на «В архив»/«Вернуть из архива» — та же формула, что и на
  // бэкенде (canAccessStudentRecord): привилегированные всегда, иначе только
  // назначенный менеджер либо ещё никому не назначенная («свободная») заявка.
  // Кнопка не должна вести к 403 — поэтому проверяем ДО показа, а не по клику.
  const canEditRow = (a: Application) => {
    if (isAdmin) return true;
    const assigned = a.managerId || a.chinaManagerId;
    if (!assigned) return true;
    return a.managerId === me?.id || a.chinaManagerId === me?.id;
  };

  const onArchive = async (a: Application, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: 'В архив',
      message: `Отправить заявку «${a.fullName}» в архив? Её можно будет вернуть в любой момент.`,
      confirmText: 'В архив',
    });
    if (!ok) return;
    try {
      await archiveApplication(a.id);
      toast('Заявка отправлена в архив', 'success');
      load();
      loadCounts();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка архивации', 'error');
    }
  };

  // ТЗ 3.1 — эвристика «повторного обращения» по телефону ложно срабатывает на
  // общем семейном номере (брат и сестра). Без снятия пометки вторая заявка
  // навсегда остаётся во вкладке «Архив» и искажает её счётчик — поэтому
  // перезагружаем и список, и счётчики вкладок.
  const onClearRepeat = async (a: Application, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await clearRepeatApplication(a.id);
      toast('Пометка «Повторное обращение» снята', 'success');
      load();
      loadCounts();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка', 'error');
    }
  };

  const onUnarchive = async (a: Application, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await unarchiveApplication(a.id);
      toast('Заявка возвращена из архива', 'success');
      load();
      loadCounts();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка', 'error');
    }
  };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="card-header">
        <h2 className="card-title">Заявки</h2>
        {isAdmin && (
          <div className="scope-switch">
            <button
              className={`scope-btn${scope === 'mine' ? ' active' : ''}`}
              onClick={() => onFilterChange('scope', 'mine')}
            >
              <Icon name="person" size={16} />
              Мои
            </button>
            <button
              className={`scope-btn${scope === 'all' ? ' active' : ''}`}
              onClick={() => onFilterChange('scope', 'all')}
            >
              <Icon name="groups" size={16} />
              Все
            </button>
          </div>
        )}
      </div>
      <div className="card-body">
        {/* ТЗ 3.1 — «Новые заявки» / «Ранее зарегистрированные / Архив» + служебные
            вкладки «Все»/«В работе». Ось независимая от «Мои/Все» выше (владение
            против стадии) — видна всем ролям, бэкенд сам сужает видимость. */}
        <div className="scope-switch" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              className={`scope-btn${tab === t ? ' active' : ''}`}
              onClick={() => onTabChange(t)}
              title={TAB_TITLE[t]}
            >
              <Icon name={TAB_ICON[t]} size={16} />
              {TAB_LABEL[t]} ({tabCounts[t]})
            </button>
          ))}
        </div>

        <div className="filters">
          <input
            placeholder="Поиск по ФИО, телефону, email..."
            value={search}
            onChange={(e) => onFilterChange('search', e.target.value)}
          />
          <select value={status} onChange={(e) => onFilterChange('status', e.target.value)}>
            <option value="">Все статусы</option>
            <option value="NEW">Новая заявка</option>
            <option value="DOCS_REVIEW">Документы на проверке</option>
            <option value="DOCS_SUBMITTED">Подача документов</option>
            <option value="PRE_ADMISSION">Предварительное зачисление</option>
            <option value="AWAITING_PAYMENT">Ожидание оплаты</option>
            <option value="ENROLLED">Зачислен</option>
          </select>
          {isAdmin && (
            <select value={manager} onChange={(e) => onFilterChange('manager', e.target.value)} title="Фильтр по менеджеру">
              <option value="">Все менеджеры</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          )}
          <select value={direction} onChange={(e) => onFilterChange('direction', e.target.value)}>
            <option value="">Все направления</option>
            <DirectionOptions />
          </select>
          <select value={source} onChange={(e) => onFilterChange('source', e.target.value)} title="Фильтр по источнику привлечения">
            <option value="">Все источники</option>
            <option value="NONE">Не указан</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => onFilterChange('from', e.target.value)}
            title="Дата создания от"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => onFilterChange('to', e.target.value)}
            title="Дата создания до"
          />
        </div>

        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : total === 0 ? (
            <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="empty-icon"><Icon name="inbox" size={48} /></div>
              {scope === 'mine' ? 'У вас пока нет назначенных заявок' : 'Заявок не найдено'}
            </motion.div>
          ) : (
            <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>ФИО</th><th>Телефон</th><th>Направление</th><th>Источник</th><th>Менеджер</th><th>Статус</th><th>Дата</th><th>Действия</th>
                  </tr>
                </thead>
                <motion.tbody
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
                >
                  {pagedItems.map((a) => (
                    <motion.tr
                      key={a.id}
                      onClick={() => navigate(`/applications/${a.id}`)}
                      variants={{
                        hidden: { opacity: 0, x: -10 },
                        show: { opacity: 1, x: 0, transition: { duration: 0.25 } },
                      }}
                      whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)', x: 2 }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <strong>{a.fullName}</strong>
                        {a.repeatOfId && (
                          <>
                            <span
                              className="badge badge-warning"
                              style={{ marginLeft: 6 }}
                              title="По телефону/email похоже на повторное обращение"
                            >
                              Повторное
                            </span>
                            {canEditRow(a) && (
                              <button
                                className="btn btn-sm btn-secondary"
                                style={{ marginLeft: 6 }}
                                onClick={(e) => onClearRepeat(a, e)}
                                title="Снять пометку «Повторное обращение»"
                              >
                                Не повторное
                              </button>
                            )}
                          </>
                        )}
                        {a.archivedAt && (
                          <span className="badge badge-gray" style={{ marginLeft: 6 }}>В архиве</span>
                        )}
                      </td>
                      <td data-label="Телефон">{a.phone}</td>
                      <td data-label="Направление">{DIRECTION_LABEL[a.direction]}</td>
                      <td data-label="Источник">
                        <span className={`badge ${a.source ? 'badge-info' : 'badge-gray'}`}>{leadSourceLabel(a.source)}</span>
                      </td>
                      <td data-label="Менеджеры">
                        <div className="mgr-cell">
                          <div className="mgr-row">
                            <span className="mgr-tag tj">TJ</span>
                            {a.manager ? (
                              <span className={a.manager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>
                                {a.manager.fullName}
                              </span>
                            ) : (
                              <span className="mgr-none">—</span>
                            )}
                          </div>
                          <div className="mgr-row">
                            <span className="mgr-tag cn">CN</span>
                            {a.chinaManager ? (
                              <span className={a.chinaManager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>
                                {a.chinaManager.fullName}
                              </span>
                            ) : (
                              <span className="mgr-none">—</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td data-label="Статус"><span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span></td>
                      <td data-label="Дата">{new Date(a.createdAt).toLocaleDateString('ru-RU')}</td>
                      <td data-label="Действия" onClick={(e) => e.stopPropagation()}>
                        {canEditRow(a) && (
                          a.archivedAt ? (
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={(e) => onUnarchive(a, e)}
                              title="Вернуть из архива"
                            >
                              <Icon name="unarchive" size={14} />
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={(e) => onArchive(a, e)}
                              title="Отправить в архив"
                            >
                              <Icon name="archive" size={14} />
                            </button>
                          )
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </motion.tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>

        {!loading && (
          <Pagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={(p) => setFilter('page', String(p))}
          />
        )}
      </div>
    </motion.div>
  );
}
