import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listApplications } from '../api/applications';
import type { Application, ApplicationStatus, Direction } from '../api/types';
import { DIRECTION_LABEL, STATUS_BADGE, STATUS_LABEL } from '../api/types';

export default function Applications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Application[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | ''>('');
  const [direction, setDirection] = useState<Direction | ''>('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    listApplications({
      search: search || undefined,
      status: status || undefined,
      direction: direction || undefined,
    })
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search, status, direction]);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="card-header">
        <h2 className="card-title">Все заявки</h2>
      </div>
      <div className="card-body">
        <div className="filters">
          <input placeholder="Поиск по ФИО, телефону, email..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="">Все статусы</option>
            <option value="NEW">Новые</option>
            <option value="IN_PROGRESS">В работе</option>
            <option value="COMPLETED">Завершённые</option>
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="">Все направления</option>
            <option value="BACHELOR">Бакалавриат</option>
            <option value="MASTER">Магистратура</option>
            <option value="LANGUAGE">Языковые курсы</option>
          </select>
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              className="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Загрузка...
            </motion.div>
          ) : items.length === 0 ? (
            <motion.div
              key="empty"
              className="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="empty-icon">📭</div>Заявок не найдено
            </motion.div>
          ) : (
            <motion.div
              key="table"
              className="table-wrap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <table className="table">
                <thead>
                  <tr>
                    <th>ФИО</th><th>Телефон</th><th>Направление</th><th>Статус</th><th>Дата</th>
                  </tr>
                </thead>
                <motion.tbody
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
                >
                  {items.map((a) => (
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
                      <td>{a.phone}</td>
                      <td>{DIRECTION_LABEL[a.direction]}</td>
                      <td><span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span></td>
                      <td>{new Date(a.createdAt).toLocaleDateString('ru-RU')}</td>
                    </motion.tr>
                  ))}
                </motion.tbody>
              </table>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
