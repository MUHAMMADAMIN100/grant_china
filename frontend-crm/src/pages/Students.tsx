import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listStudents, listStudentsPaged } from '../api/students';
import { listUsers } from '../api/users';
import { listGrants, ordinalShortRu } from '../api/grants';
import type { Direction, Student, User } from '../api/types';
import { DIRECTION_LABEL, STATUS_BADGE, STATUS_LABEL, STUDENT_STATUS_BADGE, STUDENT_STATUS_LABEL, isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { generateStudentsReport } from '../utils/studentsReport';
import DirectionOptions from '../components/DirectionOptions';
import Pagination from '../components/Pagination';
import Icon from '../Icon';
import { useUrlFilter } from '../hooks/useUrlFilter';

const PAGE_SIZE = 10;

const GRANT_FILTER_LABEL: Record<'multi' | 'any' | 'none', string> = {
  multi: 'Двойной грант',
  any: 'Есть грант',
  none: 'Без гранта',
};

export default function Students() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  // FOUNDER + ADMIN видят всех студентов; EMPLOYEE — только своих.
  const isAdmin = isPrivileged(me?.role);

  // Все фильтры — в URL, чтобы при возврате назад они восстанавливались.
  const defaults = useMemo(
    () => ({
      search: '',
      direction: '',
      stageFilter: '',
      cabinet: '',
      manager: '',
      scope: isAdmin ? 'all' : 'mine',
      // Раздел 4 ТЗ (волна 4) — реестр «двойных грантов» как фильтр общего
      // списка студентов, а не отдельный экран. По умолчанию выключен —
      // данных о грантах на старте почти нет, лишний параметр в URL не нужен.
      grant: '',
      page: '1',
    }),
    [isAdmin],
  );
  const [filters, setFilter, setFilters] = useUrlFilter(defaults);
  const search = filters.search;
  const direction = filters.direction as Direction | '';
  const stageFilter = filters.stageFilter;
  const cabinet = filters.cabinet;
  const manager = filters.manager;
  const scope = filters.scope as 'all' | 'mine';
  const grant = filters.grant as 'multi' | 'any' | 'none' | '';
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Счётчик поколений запросов списка. debounce откладывает СТАРТ, но уже
  // улетевший запрос не отменяет: медленный ответ по «Ива» приходил после
  // быстрого по «Иванов» и перерисовывал таблицу чужими студентами, а
  // пагинация считалась по чужому total. Ответ с устаревшим номером
  // отбрасываем — это же снимает гонку с realtime-перезагрузкой.
  const reqRef = useRef(0);

  // Realtime debounce — несколько событий за 500мс схлопываются в один load().
  // Без этого 'student:updated' + 'application:new' + 'application:updated'
  // от одного действия делали 3 полных перезагрузки.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      load();
    }, 500);
  };

  const load = () => {
    const my = ++reqRef.current;
    setLoading(true);
    setError(null);
    listStudentsPaged({
      search: search || undefined,
      direction: direction || undefined,
      cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
      mine: scope === 'mine',
      manager: manager || undefined,
      stage: stageFilter || undefined,
      grant: grant || undefined,
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
        setError(e?.response?.data?.message || 'Не удалось загрузить список студентов');
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
  }, [search, direction, cabinet, scope, manager, stageFilter, grant, page]);

  // При перезагрузке после realtime/удаления — если страница перешла
  // за пределы (например, удалили последнего на странице), сдвигаемся
  // на ближайшую существующую.
  useEffect(() => {
    if (loading) return;
    if (total === 0) return;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) setFilter('page', String(totalPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, loading]);

  // Серверная пагинация: items уже страница, total приходит отдельно.
  const pagedItems = items;

  // При смене любого фильтра сбрасываем страницу на 1 — атомарно через
  // setFilters, иначе два setFilter подряд гонятся (второй перетирает первый).
  const onFilterChange = (
    key: 'search' | 'direction' | 'stageFilter' | 'cabinet' | 'manager' | 'scope' | 'grant',
    value: string,
  ) => {
    setFilters({ [key]: value, page: '1' });
  };

  // Список пользователей для фильтра по менеджерам — только админу
  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  useRealtime({
    'student:updated': () => scheduleReload(),
    'application:new': () => scheduleReload(),
    'application:updated': () => scheduleReload(),
  });

  // Описание применённых фильтров — для шапки Word-отчёта. Если фильтров нет,
  // вернёт пустую строку, и отчёт сам подпишет «Без фильтра — все студенты».
  const buildFilterSummary = (): string => {
    const parts: string[] = [];
    if (scope === 'mine') parts.push('Только мои');
    else if (isAdmin) parts.push('Все студенты');
    if (search) parts.push(`Поиск: «${search}»`);
    if (direction) parts.push(`Направление: ${DIRECTION_LABEL[direction as Direction]}`);
    if (stageFilter) {
      const label =
        STATUS_LABEL[stageFilter as keyof typeof STATUS_LABEL] ||
        STUDENT_STATUS_LABEL[stageFilter as keyof typeof STUDENT_STATUS_LABEL] ||
        stageFilter;
      parts.push(`Этап: ${label}`);
    }
    if (cabinet) parts.push(`Кабинет: ${cabinet}`);
    if (manager) {
      const u = users.find((x) => x.id === manager);
      parts.push(`Менеджер: ${u?.fullName || manager}`);
    }
    if (grant) parts.push(`Грант: ${GRANT_FILTER_LABEL[grant]}`);
    return parts.join(' · ');
  };

  const onDownloadReport = async () => {
    if (total === 0) {
      toast('По текущему фильтру нет студентов', 'error');
      return;
    }
    setGenerating(true);
    try {
      // Для отчёта надо ВСЕ студенты по фильтру, не одна страница.
      // Дёргаем listStudents без page/pageSize → бэкенд вернёт массив.
      // grant передаётся тем же значением, что и в списке — реестр Multi-Grant
      // (фильтр «Двойной грант») выгружается в отчёт автоматически, без
      // отдельной кнопки/экрана.
      const all = await listStudents({
        search: search || undefined,
        direction: direction || undefined,
        cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
        mine: scope === 'mine',
        manager: manager || undefined,
        stage: stageFilter || undefined,
        grant: grant || undefined,
      });
      await generateStudentsReport({
        students: all,
        filterSummary: buildFilterSummary(),
        grantByStudentId: await buildGrantColumn(all.map((s) => s.id)),
      });
      toast(`Отчёт сгенерирован (${all.length} студентов)`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Ошибка генерации отчёта', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // Раздел 4 ТЗ — колонка «Грант» в Word-отчёте. GET /students не отдаёт
  // связь grants (чтобы новое поле случайно не утекло студенту в личный
  // кабинет через include, см. решение архитектора), поэтому для отчёта
  // делаем дополнительный запрос в /grants и строим карту studentId → подпись.
  // multiOnly: false — в отчёт должен попасть любой грант, не только «двойной».
  //
  // Идём ПО ВСЕМ СТРАНИЦАМ. Бэкенд режет pageSize максимумом 100, и один
  // запрос молча обрезал бы карту: у студентов с 101-го гранта в колонке
  // стояло бы «—», неотличимое от честного «гранта нет». Отчёт, который
  // врёт без единой ошибки, хуже отчёта, который не собрался.
  const GRANTS_PAGE_SIZE = 100;
  // Страховка от бесконечного цикла, если бэкенд однажды начнёт врать про total.
  const MAX_GRANT_PAGES = 50;

  const buildGrantColumn = async (studentIds: string[]): Promise<Record<string, string>> => {
    if (studentIds.length === 0) return {};
    const idSet = new Set(studentIds);
    const map: Record<string, string> = {};
    try {
      let page = 1;
      let total = Infinity;
      while ((page - 1) * GRANTS_PAGE_SIZE < total && page <= MAX_GRANT_PAGES) {
        const res = await listGrants({ multiOnly: false, page, pageSize: GRANTS_PAGE_SIZE });
        total = res.total;
        for (const g of res.items) {
          if (!idSet.has(g.studentId) || map[g.studentId]) continue;
          map[g.studentId] = `${ordinalShortRu(g.currentYear)} из ${g.totalYears}`;
        }
        if (res.items.length === 0) break;
        page += 1;
      }
      return map;
    } catch {
      // Частично собранная карта лучше пустой: то, что успели, попадёт в отчёт.
      return map;
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
        <h2 className="card-title">База студентов</h2>
        <div className="card-header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <motion.button
            className="btn btn-secondary"
            onClick={onDownloadReport}
            disabled={generating || total === 0}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            title={total === 0 ? 'Нет студентов по фильтру' : `Скачать ${total} студ. в Word`}
          >
            <Icon name="description" size={16} style={{ marginRight: 4 }} />
            {generating ? 'Создание…' : 'Отчёт Word'}
          </motion.button>
          <motion.button
            className="btn btn-primary"
            onClick={() => navigate('/students/new')}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            + Новый студент
          </motion.button>
        </div>
      </div>
      <div className="card-body">
        <div className="filters">
          <input placeholder="Поиск по ФИО или телефону..." value={search} onChange={(e) => onFilterChange('search', e.target.value)} />
          <select value={direction} onChange={(e) => onFilterChange('direction', e.target.value)}>
            <option value="">Все направления</option>
            <DirectionOptions />
          </select>
          <select
            value={stageFilter}
            onChange={(e) => onFilterChange('stageFilter', e.target.value)}
            title="Фильтр по этапу заявки"
          >
            <option value="">Все статусы</option>
            <optgroup label="Этап заявки">
              <option value="NEW">Новая заявка</option>
              <option value="DOCS_REVIEW">Документы на проверке</option>
              <option value="DOCS_SUBMITTED">Подача документов</option>
              <option value="PRE_ADMISSION">Предв. зачисление</option>
              <option value="AWAITING_PAYMENT">Ожидает оплаты</option>
              <option value="ENROLLED">Зачислен</option>
            </optgroup>
            <optgroup label="Особые">
              <option value="PAUSED">Приостановлен</option>
              <option value="GRADUATED">Выпустился</option>
              <option value="ARCHIVED">В архиве</option>
            </optgroup>
          </select>
          <select value={cabinet} onChange={(e) => onFilterChange('cabinet', e.target.value)}>
            <option value="">Все кабинеты</option>
            <option value="1">Кабинет 1</option>
            <option value="2">Кабинет 2</option>
            <option value="3">Кабинет 3</option>
          </select>
          {isAdmin && (
            <select
              value={manager}
              onChange={(e) => onFilterChange('manager', e.target.value)}
              title="Фильтр по менеджеру"
            >
              <option value="">Все менеджеры</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          )}
          <select
            value={grant}
            onChange={(e) => onFilterChange('grant', e.target.value)}
            title="Реестр «двойных грантов» (раздел 4 ТЗ)"
          >
            <option value="">Любой грант</option>
            <option value="multi">Двойной грант (2+ года)</option>
            <option value="any">Есть грант</option>
            <option value="none">Без гранта</option>
          </select>
        </div>

        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : total === 0 ? (
            <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="empty-icon"><Icon name="school" size={48} /></div>
              {scope === 'mine' ? 'У вас пока нет назначенных студентов' : 'Студентов не найдено'}
            </motion.div>
          ) : (
            <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>ФИО</th><th>Телефоны</th><th>Направление</th><th>Кабинет</th><th>Менеджер</th><th>Статус</th>
                  </tr>
                </thead>
                <motion.tbody
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
                >
                  {pagedItems.map((s) => (
                    <motion.tr
                      key={s.id}
                      onClick={() => navigate(`/students/${s.id}`)}
                      variants={{
                        hidden: { opacity: 0, x: -10 },
                        show: { opacity: 1, x: 0, transition: { duration: 0.25 } },
                      }}
                      whileHover={{ backgroundColor: 'rgba(0,0,0,0.02)', x: 2 }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td><strong>{s.fullName}</strong></td>
                      <td data-label="Телефоны">{s.phones.join(', ') || '—'}</td>
                      <td data-label="Направление">{DIRECTION_LABEL[s.direction]}</td>
                      <td data-label="Кабинет">№{s.cabinet}</td>
                      <td data-label="Менеджеры">
                        <div className="mgr-cell">
                          <div className="mgr-row">
                            <span className="mgr-tag tj">TJ</span>
                            {s.manager ? (
                              <span className={s.manager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>
                                {s.manager.fullName}
                              </span>
                            ) : (
                              <span className="mgr-none">—</span>
                            )}
                          </div>
                          <div className="mgr-row">
                            <span className="mgr-tag cn">CN</span>
                            {s.chinaManager ? (
                              <span className={s.chinaManager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>
                                {s.chinaManager.fullName}
                              </span>
                            ) : (
                              <span className="mgr-none">—</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td data-label="Статус">
                        {(() => {
                          const appStatus = s.applications?.[0]?.status;
                          if (s.status !== 'ACTIVE' || !appStatus) {
                            return (
                              <span className={`badge ${STUDENT_STATUS_BADGE[s.status]}`}>
                                {STUDENT_STATUS_LABEL[s.status]}
                              </span>
                            );
                          }
                          return (
                            <span className={`badge ${STATUS_BADGE[appStatus]}`}>
                              {STATUS_LABEL[appStatus]}
                            </span>
                          );
                        })()}
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
