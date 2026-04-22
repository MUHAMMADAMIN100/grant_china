import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listStudents } from '../api/students';
import type { Direction, Student, StudentStatus } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_BADGE, STUDENT_STATUS_LABEL } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { generateStudentsReport } from '../utils/studentsReport';
import Icon from '../Icon';

type Scope = 'all' | 'mine';

export default function Students() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { toast } = useUI();
  const [items, setItems] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<Direction | ''>('');
  const [status, setStatus] = useState<StudentStatus | ''>('');
  const [cabinet, setCabinet] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [loading, setLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [generating, setGenerating] = useState(false);

  const load = () => {
    setLoading(true);
    listStudents({
      search: search || undefined,
      direction: direction || undefined,
      status: status || undefined,
      cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
      mine: scope === 'mine',
    })
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search, direction, status, cabinet, scope]);

  const onDownloadReport = async () => {
    setGenerating(true);
    try {
      const all = await listStudents({});
      const from = reportFrom ? new Date(reportFrom + 'T00:00:00') : null;
      const to = reportTo ? new Date(reportTo + 'T23:59:59') : null;
      const filtered = all.filter((s) => {
        const d = new Date(s.createdAt);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
      if (filtered.length === 0) {
        toast('За выбранный период нет студентов', 'error');
        setGenerating(false);
        return;
      }
      await generateStudentsReport({
        students: filtered,
        from: reportFrom || undefined,
        to: reportTo || undefined,
      });
      toast(`Отчёт сгенерирован (${filtered.length} студентов)`, 'success');
      setReportOpen(false);
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <motion.button
            className="btn btn-secondary"
            onClick={() => setReportOpen(true)}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            title="Скачать отчёт в PDF"
          >
            <Icon name="download" size={16} style={{ marginRight: 4 }} />
            Отчёт PDF
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
            <option value="BACHELOR">Бакалавриат</option>
            <option value="MASTER">Магистратура</option>
            <option value="LANGUAGE">Языковые курсы</option>
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
                  {items.map((s) => (
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
                      <td data-label="Менеджер">
                        {s.manager ? (
                          <span className={s.manager.id === me?.id ? 'mgr-mine' : 'mgr-other'}>
                            {s.manager.fullName}
                            {s.manager.id === me?.id && <span className="mgr-you"> (вы)</span>}
                          </span>
                        ) : (
                          <span className="mgr-none">—</span>
                        )}
                      </td>
                      <td data-label="Статус"><span className={`badge ${STUDENT_STATUS_BADGE[s.status]}`}>{STUDENT_STATUS_LABEL[s.status]}</span></td>
                    </motion.tr>
                  ))}
                </motion.tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>
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
                <Icon name="download" size={28} />
              </div>
              <div className="dialog-title">Отчёт по студентам</div>
              <div className="dialog-message">
                Выберите период. Без указания дат в отчёт попадут все студенты.
              </div>

              <div className="form-grid-2" style={{ textAlign: 'left', marginBottom: 20 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>От</label>
                  <input
                    type="date"
                    value={reportFrom}
                    onChange={(e) => setReportFrom(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>До</label>
                  <input
                    type="date"
                    value={reportTo}
                    onChange={(e) => setReportTo(e.target.value)}
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
                  disabled={generating}
                  whileTap={{ scale: 0.97 }}
                >
                  {generating ? 'Создание…' : 'Скачать PDF'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
