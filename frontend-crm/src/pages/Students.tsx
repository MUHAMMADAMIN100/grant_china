import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listStudents } from '../api/students';
import type { Direction, Student, StudentStatus } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_BADGE, STUDENT_STATUS_LABEL } from '../api/types';

export default function Students() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<Direction | ''>('');
  const [status, setStatus] = useState<StudentStatus | ''>('');
  const [cabinet, setCabinet] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    listStudents({
      search: search || undefined,
      direction: direction || undefined,
      status: status || undefined,
      cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
    })
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search, direction, status, cabinet]);

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">База студентов</h2>
        <button className="btn btn-primary" onClick={() => navigate('/students/new')}>+ Новый студент</button>
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

        {loading ? (
          <div className="empty">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="empty"><div className="empty-icon">🎓</div>Студентов не найдено</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ФИО</th><th>Телефоны</th><th>Направление</th><th>Кабинет</th><th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} onClick={() => navigate(`/students/${s.id}`)}>
                    <td><strong>{s.fullName}</strong></td>
                    <td>{s.phones.join(', ') || '—'}</td>
                    <td>{DIRECTION_LABEL[s.direction]}</td>
                    <td>№{s.cabinet}</td>
                    <td><span className={`badge ${STUDENT_STATUS_BADGE[s.status]}`}>{STUDENT_STATUS_LABEL[s.status]}</span></td>
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
