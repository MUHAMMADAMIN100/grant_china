import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listStudents } from '../api/students';
import { listUsers } from '../api/users';
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

const PAGE_SIZE = 5;

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
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Student[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = () => {
    setLoading(true);
    listStudents({
      search: search || undefined,
      direction: direction || undefined,
      cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
      mine: scope === 'mine',
      manager: manager || undefined,
    })
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, direction, cabinet, scope, manager]);

  // Фильтр по этапу — клиентский, чтобы не трогать backend. Особые
  // статусы студента (PAUSED/GRADUATED/ARCHIVED) тоже идут через этот же
  // фильтр для удобства.
  const SPECIAL_STUDENT_STATUSES = ['PAUSED', 'GRADUATED', 'ARCHIVED'];

  const filteredItems = stageFilter
    ? items.filter((s) => {
        if (SPECIAL_STUDENT_STATUSES.includes(stageFilter)) {
          return s.status === stageFilter;
        }
        // Этап заявки — берём последнюю, фильтруем активных
        if (s.status !== 'ACTIVE') return false;
        return s.applications?.[0]?.status === stageFilter;
      })
    : items;

  // При изменении набора студентов извне (realtime/удаление) — корректируем
  // текущую страницу, чтобы не остаться на пустой. ВАЖНО: пропускаем пока
  // данные ещё грузятся (loading=true) или filteredItems пустой, иначе
  // при возврате назад с `?page=4` мгновенно сбрасывалось бы на 1 (потому
  // что filteredItems на старте пустой ⇒ totalPages=1 ⇒ 4>1 ⇒ setFilter '1').
  useEffect(() => {
    if (loading) return;
    if (filteredItems.length === 0) return;
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
    if (page > totalPages) setFilter('page', String(totalPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItems.length, loading]);

  const pagedItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // При смене любого фильтра сбрасываем страницу на 1 — атомарно через
  // setFilters, иначе два setFilter подряд гонятся (второй перетирает первый).
  const onFilterChange = (
    key: 'search' | 'direction' | 'stageFilter' | 'cabinet' | 'manager' | 'scope',
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
    'student:updated': () => load(),
    'application:new': () => load(),
    'application:updated': () => load(),
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
    return parts.join(' · ');
  };

  const onDownloadReport = async () => {
    if (filteredItems.length === 0) {
      toast('По текущему фильтру нет студентов', 'error');
      return;
    }
    setGenerating(true);
    try {
      await generateStudentsReport({
        students: filteredItems,
        filterSummary: buildFilterSummary(),
      });
      toast(`Отчёт сгенерирован (${filteredItems.length} студентов)`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Ошибка генерации отчёта', 'error');
    } finally {
      setGenerating(false);
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
            disabled={generating || filteredItems.length === 0}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            title={filteredItems.length === 0 ? 'Нет студентов по фильтру' : `Скачать ${filteredItems.length} студ. в Word`}
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
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : filteredItems.length === 0 ? (
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
            total={filteredItems.length}
            pageSize={PAGE_SIZE}
            onChange={(p) => setFilter('page', String(p))}
          />
        )}
      </div>

    </motion.div>
  );
}
