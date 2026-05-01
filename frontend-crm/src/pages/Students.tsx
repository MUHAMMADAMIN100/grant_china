import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listStudents } from '../api/students';
import { listUsers } from '../api/users';
import type { Direction, Student, StudentStatus, User } from '../api/types';
import { DIRECTION_LABEL, STATUS_BADGE, STATUS_LABEL, STUDENT_STATUS_BADGE, STUDENT_STATUS_LABEL } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import { generateStudentsReport } from '../utils/studentsReport';
import DirectionOptions from '../components/DirectionOptions';
import Icon from '../Icon';

type Scope = 'all' | 'mine';

const PAGE_SIZE = 5;

/**
 * Возвращает массив элементов пагинации в стиле Google: номера страниц
 * с эллипсисами вокруг текущей. Пример при 50 страницах и текущей 6:
 * `[1, '…', 4, 5, 6, 7, 8, '…', 50]`.
 */
function buildPageRange(current: number, total: number): (number | '…')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: (number | '…')[] = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

export default function Students() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  const [items, setItems] = useState<Student[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<Direction | ''>('');
  const [status, setStatus] = useState<StudentStatus | ''>('');
  const [cabinet, setCabinet] = useState('');
  const [manager, setManager] = useState<string>('');
  const isAdmin = me?.role === 'ADMIN';
  // Менеджер видит только своих студентов; админ может переключать.
  const [scope, setScope] = useState<Scope>(isAdmin ? 'all' : 'mine');
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [page, setPage] = useState(1);

  const load = () => {
    setLoading(true);
    listStudents({
      search: search || undefined,
      direction: direction || undefined,
      status: status || undefined,
      cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
      mine: scope === 'mine',
      manager: manager || undefined,
    })
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setPage(1); // при смене любого фильтра — на первую страницу
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, direction, status, cabinet, scope, manager]);

  // При изменении набора студентов извне (realtime/удаление) — корректируем
  // текущую страницу, чтобы не остаться на пустой.
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (page > totalPages) setPage(totalPages);
  }, [items.length, page]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pagedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageRange = buildPageRange(page, totalPages);
  const rangeStart = items.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, items.length);

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

  const reportDatesValid =
    !!reportFrom && !!reportTo && new Date(reportFrom) <= new Date(reportTo);

  const onDownloadReport = async () => {
    if (!reportFrom || !reportTo) {
      toast('Выберите обе даты: "От" и "До"', 'error');
      return;
    }
    if (new Date(reportFrom) > new Date(reportTo)) {
      toast('Дата "До" должна быть позже "От"', 'error');
      return;
    }
    setGenerating(true);
    try {
      const all = await listStudents({});
      const from = new Date(reportFrom + 'T00:00:00');
      const to = new Date(reportTo + 'T23:59:59');
      const filtered = all.filter((s) => {
        const d = new Date(s.createdAt);
        return d >= from && d <= to;
      });
      if (filtered.length === 0) {
        toast('За выбранный период нет студентов', 'error');
        setGenerating(false);
        return;
      }
      await generateStudentsReport({
        students: filtered,
        from: reportFrom,
        to: reportTo,
      });
      toast(`Отчёт сгенерирован (${filtered.length} студентов)`, 'success');
      setReportOpen(false);
      setReportFrom('');
      setReportTo('');
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
                onClick={() => setScope('mine')}
              >
                <Icon name="person" size={16} />
                Мои
              </button>
              <button
                className={`scope-btn${scope === 'all' ? ' active' : ''}`}
                onClick={() => setScope('all')}
              >
                <Icon name="groups" size={16} />
                Все
              </button>
            </div>
          )}
          <motion.button
            className="btn btn-secondary"
            onClick={() => setReportOpen(true)}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            title="Скачать отчёт в Word"
          >
            <Icon name="description" size={16} style={{ marginRight: 4 }} />
            Отчёт Word
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
          <input placeholder="Поиск по ФИО или телефону..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="">Все направления</option>
            <DirectionOptions />
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="">Все статусы</option>
            <option value="ACTIVE">Активные</option>
            <option value="PAUSED">Приостановлены</option>
            <option value="GRADUATED">Выпустились</option>
            <option value="ARCHIVED">В архиве</option>
          </select>
          <select value={cabinet} onChange={(e) => setCabinet(e.target.value)}>
            <option value="">Все кабинеты</option>
            <option value="1">Кабинет 1</option>
            <option value="2">Кабинет 2</option>
            <option value="3">Кабинет 3</option>
          </select>
          {isAdmin && (
            <select
              value={manager}
              onChange={(e) => setManager(e.target.value)}
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
          ) : items.length === 0 ? (
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

        {!loading && items.length > PAGE_SIZE && (
          <div className="pagination">
            <div className="pagination-info">
              Показано {rangeStart}–{rangeEnd} из {items.length}
            </div>
            <div className="pagination-controls">
              <button
                className="pg-btn pg-arrow"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                title="Предыдущая страница"
              >
                <Icon name="chevron_left" size={16} />
                Назад
              </button>
              {pageRange.map((p, i) =>
                p === '…' ? (
                  <span key={`gap-${i}`} className="pg-gap">…</span>
                ) : (
                  <button
                    key={p}
                    className={`pg-btn pg-num${p === page ? ' active' : ''}`}
                    onClick={() => setPage(p)}
                    aria-current={p === page ? 'page' : undefined}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                className="pg-btn pg-arrow"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                title="Следующая страница"
              >
                Далее
                <Icon name="chevron_right" size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {reportOpen && (
          <motion.div
            className="dialog-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !generating && setReportOpen(false)}
          >
            <motion.div
              className="dialog-card"
              style={{ maxWidth: 460 }}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dialog-icon">
                <Icon name="description" size={28} />
              </div>
              <div className="dialog-title">Отчёт по студентам (Word)</div>
              <div className="dialog-message">
                Укажите обе даты — "От" и "До". В отчёт попадут студенты, зарегистрированные в этот период.
              </div>

              <div className="form-grid-2" style={{ textAlign: 'left', marginBottom: 20 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>От *</label>
                  <input
                    type="date"
                    value={reportFrom}
                    max={reportTo || undefined}
                    onChange={(e) => setReportFrom(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>До *</label>
                  <input
                    type="date"
                    value={reportTo}
                    min={reportFrom || undefined}
                    onChange={(e) => setReportTo(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="dialog-actions">
                <motion.button
                  className="btn btn-secondary"
                  onClick={() => setReportOpen(false)}
                  disabled={generating}
                  whileTap={{ scale: 0.97 }}
                >
                  Отмена
                </motion.button>
                <motion.button
                  className="btn btn-primary"
                  onClick={onDownloadReport}
                  disabled={generating || !reportDatesValid}
                  whileTap={{ scale: 0.97 }}
                  style={!reportDatesValid && !generating ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                  title={!reportDatesValid ? 'Выберите обе даты' : 'Скачать Word'}
                >
                  {generating ? 'Создание…' : 'Скачать Word'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
