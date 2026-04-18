import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deleteDocument, deleteStudent, getStudent, updateStudent,
  uploadDocument, uploadPhoto,
} from '../api/students';
import type { Direction, Student, StudentStatus } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_LABEL } from '../api/types';

const API_BASE = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '');

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1024 / 1024).toFixed(2)} МБ`;
};

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState<Student | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<any>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    if (!id) return;
    const s = await getStudent(id);
    setStudent(s);
    setForm({
      fullName: s.fullName,
      phones: s.phones.join(', '),
      email: s.email || '',
      direction: s.direction,
      cabinet: s.cabinet,
      status: s.status,
      comment: s.comment || '',
    });
  };

  useEffect(() => { reload(); }, [id]);

  const onSave = async () => {
    if (!id || !form) return;
    const phones = form.phones.split(',').map((p: string) => p.trim()).filter(Boolean);
    await updateStudent(id, {
      fullName: form.fullName,
      phones,
      email: form.email || undefined,
      direction: form.direction,
      cabinet: parseInt(form.cabinet, 10),
      status: form.status,
      comment: form.comment || undefined,
    });
    await reload();
    setEdit(false);
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    await uploadPhoto(id, file);
    await reload();
  };

  const onDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    await uploadDocument(id, file);
    if (docRef.current) docRef.current.value = '';
    await reload();
  };

  const onRemoveDoc = async (docId: string) => {
    if (!confirm('Удалить документ?')) return;
    await deleteDocument(docId);
    await reload();
  };

  const onDeleteStudent = async () => {
    if (!id) return;
    if (!confirm('Удалить студента? Все документы будут удалены.')) return;
    await deleteStudent(id);
    navigate('/students');
  };

  if (!student || !form) return <div className="empty">Загрузка...</div>;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{student.fullName}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!edit && <button className="btn btn-secondary btn-sm" onClick={() => setEdit(true)}>Редактировать</button>}
          {edit && <>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEdit(false); reload(); }}>Отмена</button>
            <button className="btn btn-primary btn-sm" onClick={onSave}>Сохранить</button>
          </>}
          <button className="btn btn-danger btn-sm" onClick={onDeleteStudent}>Удалить</button>
        </div>
      </div>
      <div className="card-body">
        <div className="detail-grid">
          <div>
            <div className="detail-photo">
              {student.photoUrl ? <img src={`${API_BASE}${student.photoUrl}`} alt="" /> : '👤'}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => photoRef.current?.click()}>
              📷 Загрузить фото
            </button>
            <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPhoto} />
          </div>
          <div>
            {!edit ? (
              <>
                <div className="detail-row"><div className="detail-label">ФИО</div><div className="detail-value">{student.fullName}</div></div>
                <div className="detail-row"><div className="detail-label">Телефоны</div><div className="detail-value">{student.phones.join(', ') || '—'}</div></div>
                <div className="detail-row"><div className="detail-label">Email</div><div className="detail-value">{student.email || '—'}</div></div>
                <div className="detail-row"><div className="detail-label">Направление</div><div className="detail-value">{DIRECTION_LABEL[student.direction]}</div></div>
                <div className="detail-row"><div className="detail-label">Кабинет</div><div className="detail-value">№{student.cabinet}</div></div>
                <div className="detail-row"><div className="detail-label">Статус</div><div className="detail-value">{STUDENT_STATUS_LABEL[student.status]}</div></div>
                <div className="detail-row"><div className="detail-label">Комментарий</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{student.comment || '—'}</div></div>
                <div className="detail-row"><div className="detail-label">Создан</div><div className="detail-value">{new Date(student.createdAt).toLocaleString('ru-RU')}</div></div>
              </>
            ) : (
              <>
                <div className="form-group"><label>ФИО</label><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
                <div className="form-group"><label>Телефоны (через запятую)</label><input value={form.phones} onChange={(e) => setForm({ ...form, phones: e.target.value })} /></div>
                <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label>Направление</label>
                    <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as Direction })}>
                      <option value="BACHELOR">Бакалавриат</option>
                      <option value="MASTER">Магистратура</option>
                      <option value="LANGUAGE">Языковые курсы</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Кабинет</label>
                    <input type="number" value={form.cabinet} onChange={(e) => setForm({ ...form, cabinet: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Статус</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StudentStatus })}>
                    <option value="ACTIVE">Активный</option>
                    <option value="PAUSED">Приостановлен</option>
                    <option value="GRADUATED">Выпустился</option>
                    <option value="ARCHIVED">В архиве</option>
                  </select>
                </div>
                <div className="form-group"><label>Комментарий</label><textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></div>
              </>
            )}
          </div>
        </div>

        <h3 style={{ marginTop: 30, marginBottom: 14, fontSize: 17 }}>Документы</h3>
        <div className="documents-list">
          {(student.documents || []).map((d) => (
            <div key={d.id} className="doc-item">
              <span className="doc-icon">📄</span>
              <div className="doc-info">
                <div className="doc-name">
                  <a href={`${API_BASE}${d.url}`} target="_blank" rel="noreferrer" style={{ color: '#d52b2b' }}>
                    {d.originalName}
                  </a>
                </div>
                <div className="doc-size">{fmtBytes(d.size)} · {new Date(d.createdAt).toLocaleDateString('ru-RU')}</div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => onRemoveDoc(d.id)}>Удалить</button>
            </div>
          ))}
          {(!student.documents || student.documents.length === 0) && (
            <div className="empty" style={{ padding: 20 }}>Документов пока нет</div>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={() => docRef.current?.click()}>📎 Загрузить документ</button>
          <input ref={docRef} type="file" hidden onChange={onDoc} />
        </div>
      </div>
    </div>
  );
}
