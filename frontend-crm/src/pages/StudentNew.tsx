import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createStudent } from '../api/students';
import type { Direction } from '../api/types';

export default function StudentNew() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [direction, setDirection] = useState<Direction>('BACHELOR');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const student = await createStudent({
        fullName,
        phones: phone ? [phone] : [],
        email: email || undefined,
        direction,
        comment: comment || undefined,
      });
      navigate(`/students/${student.id}`);
    } catch (e: any) {
      setError(e.response?.data?.message?.toString() || 'Ошибка создания');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="card-header"><h2 className="card-title">Новый студент</h2></div>
      <div className="card-body">
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label>ФИО *</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Телефон</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+992 ..." />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Направление *</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
              <option value="BACHELOR">Бакалавриат → каб. 1</option>
              <option value="MASTER">Магистратура → каб. 2</option>
              <option value="LANGUAGE">Языковые курсы → каб. 3</option>
            </select>
          </div>
          <div className="form-group">
            <label>Комментарий</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/students')}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Создаём...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
