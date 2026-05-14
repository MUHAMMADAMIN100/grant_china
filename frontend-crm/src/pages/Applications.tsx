import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listApplications } from '../api/applications';
import { listUsers } from '../api/users';
import type { Application, ApplicationStatus, Direction, User } from '../api/types';
import { DIRECTION_LABEL, STATUS_BADGE, STATUS_LABEL, isPrivileged } from '../api/types';
import { useAuth } from '../store/auth';
import { useRealtime } from '../realtime';
import Icon from '../Icon';
import DirectionOptions from '../components/DirectionOptions';
import Pagination from '../components/Pagination';
import { useUrlFilter } from '../hooks/useUrlFilter';

const PAGE_SIZE = 5;

export default function Applications() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
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
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  const [items, setItems] = useState<Application[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    listApplications({
      search: search || undefined,
      status: status || undefined,
      direction: direction || undefined,
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
  }, [search, status, direction, scope, manager]);

  // При изменении набора заявок извне (realtime/удаление) — корректируем
  // текущую страницу, чтобы не остаться на пустой.
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (page > totalPages) setFilter('page', String(totalPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const pagedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Список пользователей для фильтра по менеджерам — только админу
  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  useRealtime({
    'application:new': () => load(),
    'application:updated': () => load(),
    'application:deleted': () => load(),
  });

  // При смене фильтра сбрасываем страницу на 1 — атомарно через setFilters,
  // иначе два setFilter подряд гонятся (второй перетирает первый).
  const onFilterChange = (key: 'search' | 'status' | 'direction' | 'manager' | 'scope', value: string) => {
    setFilters({ [key]: value, page: '1' });
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
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Загрузка...
            </motion.div>
          ) : items.length === 0 ? (
            <motion.div key="empty" className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="empty-icon"><Icon name="inbox" size={48} /></div>
              {scope === 'mine' ? 'У вас пока нет назначенных заявок' : 'Заявок не найдено'}
            </motion.div>
          ) : (
            <motion.div key="table" className="table-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>ФИО</th><th>Телефон</th><th>Направление</th><th>Менеджер</th><th>Статус</th><th>Дата</th>
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
                      <td><strong>{a.fullName}</strong></td>
                      <td data-label="Телефон">{a.phone}</td>
                      <td data-label="Направление">{DIRECTION_LABEL[a.direction]}</td>
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
            total={items.length}
            pageSize={PAGE_SIZE}
            onChange={(p) => setFilter('page', String(p))}
          />
        )}
      </div>
    </motion.div>
  );
}
