import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assignStudentManager, deleteStudent, getStudent, updateStudent, uploadPhoto } from '../api/students';
import type { Direction, Student, StudentStatus } from '../api/types';
import { DIRECTION_LABEL, STUDENT_STATUS_LABEL } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import DocumentsChecklist from '../components/DocumentsChecklist';
import ManagerBar from '../components/ManagerBar';
import Icon from '../Icon';

const API_BASE = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '');

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [student, setStudent] = useState<Student | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<any>(null);
  const photoRef = useRef<HTMLInputElement>(null);

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
    try {
      await updateStudent(id, {
        fullName: form.fullName,
        phones,
        email: form.email || undefined,
        direction: form.direction,
        cabinet: parseInt(form.cabinet, 10),
        status: form.status,
        comment: form.comment || undefined,
      });
      toast('Данные сохранены', 'success');
      await reload();
      setEdit(false);
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка сохранения', 'error');
    }
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    try {
      await uploadPhoto(id, file);
      toast('Фото загружено', 'success');
      await reload();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка загрузки', 'error');
    }
  };

  const onReassign = async (patch: { managerId?: string | null; chinaManagerId?: string | null }) => {
    if (!id) return;
    await assignStudentManager(id, patch);
    await reload();
  };

  const onDeleteStudent = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Удалить студента',
      message: 'Все документы будут удалены. Действие нельзя отменить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteStudent(id);
      toast('Студент удалён', 'success');
      navigate('/students');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  if (!student || !form) return <div className="empty">Загрузка...</div>;

  const isAdmin = me?.role === 'ADMIN';
  const assigned = !!student.managerId || !!student.chinaManagerId;
  const isMine = !assigned || student.managerId === me?.id || student.chinaManagerId === me?.id;
  const canEdit = isAdmin || isMine;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{student.fullName}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canEdit && !edit && <button className="btn btn-secondary btn-sm" onClick={() => setEdit(true)}>Редактировать</button>}
          {canEdit && edit && <>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEdit(false); reload(); }}>Отмена</button>
            <button className="btn btn-primary btn-sm" onClick={onSave}>Сохранить</button>
          </>}
          {canEdit && <button className="btn btn-danger btn-sm" onClick={onDeleteStudent}>Удалить</button>}
        </div>
      </div>
      <div className="card-body">
        <ManagerBar
          manager={student.manager}
          chinaManager={student.chinaManager}
          onReassign={onReassign}
        />
        <div className="detail-grid">
          <div>
            <div className="detail-photo">
              {student.photoUrl
                ? <img src={`${API_BASE}${student.photoUrl}`} alt="" />
                : <Icon name="person" size={80} style={{ color: 'var(--text-light)' }} />}
            </div>
            {canEdit && (
              <>
                <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => photoRef.current?.click()}>
                  <Icon name="photo_camera" size={18} style={{ marginRight: 6 }} />
                  Загрузить фото
                </button>
                <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPhoto} />
              </>
            )}
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

        <DocumentsChecklist
          studentId={student.id}
          studentName={student.fullName}
          documents={student.documents || []}
          onChange={reload}
          editable={canEdit}
        />
      </div>
    </div>
  );
}
