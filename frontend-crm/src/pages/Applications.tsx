import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
    <div className="card">
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

        {loading ? (
          <div className="empty">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="empty"><div className="empty-icon">📭</div>Заявок не найдено</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ФИО</th><th>Телефон</th><th>Направление</th><th>Статус</th><th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} onClick={() => navigate(`/applications/${a.id}`)}>
                    <td><strong>{a.fullName}</strong></td>
                    <td>{a.phone}</td>
                    <td>{DIRECTION_LABEL[a.direction]}</td>
                    <td><span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span></td>
                    <td>{new Date(a.createdAt).toLocaleDateString('ru-RU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
