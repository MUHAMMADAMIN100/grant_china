import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assignApplicationManager, deleteApplication, getApplication, updateApplication } from '../api/applications';
import { getStudent, updateStudent, uploadPhoto } from '../api/students';
import type { Application, ApplicationStatus, Direction, Student, StudentStatus } from '../api/types';
import { DIRECTION_LABEL, STATUS_BADGE, STATUS_LABEL, STUDENT_STATUS_LABEL } from '../api/types';
import { useAuth } from '../store/auth';
import { useUI } from '../ui/Dialogs';
import { useRealtime } from '../realtime';
import DocumentsChecklist, { REQUIRED_DOCUMENTS } from '../components/DocumentsChecklist';
import ManagerBar from '../components/ManagerBar';
import Icon from '../Icon';

const API_BASE = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api').replace(/\/api$/, '');

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { confirm, toast } = useUI();
  const [app, setApp] = useState<Application | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    if (!id) return;
    try {
      const a = await getApplication(id);
      setApp(a);
      if (a.studentId) {
        const s = await getStudent(a.studentId);
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
      } else {
        setStudent(null);
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { reload(); }, [id]);

  useRealtime({
    'application:updated': (data: any) => {
      if (data?.application?.id === id || data?.studentId === app?.studentId) reload();
    },
    'student:updated': (data: any) => {
      if (data?.studentId && data.studentId === app?.studentId) reload();
    },
    'document:uploaded': (data: any) => {
      if (data?.studentId === app?.studentId) reload();
    },
    'document:deleted': (data: any) => {
      if (data?.studentId === app?.studentId) reload();
    },
  });

  const onStatus = async (status: ApplicationStatus) => {
    if (!id) return;
    try {
      await updateApplication(id, { status });
      if (status === 'IN_PROGRESS') toast('Заявка взята в работу. Создана карточка студента.', 'success');
      if (status === 'COMPLETED') toast('Заявка завершена. Студент доступен в разделе «Студенты».', 'success');
      await reload();
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка изменения статуса', 'error');
    }
  };

  const onReassign = async (patch: { managerId?: string | null; chinaManagerId?: string | null }) => {
    if (!id) return;
    await assignApplicationManager(id, patch);
    await reload();
  };

  const onDeleteApp = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Удалить заявку',
      message: student
        ? 'Заявка будет удалена вместе с карточкой студента и всеми документами.'
        : 'Заявка будет удалена. Действие нельзя отменить.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteApplication(id);
      toast('Заявка удалена', 'success');
      navigate('/applications');
    } catch (e: any) {
      toast(e?.response?.data?.message || 'Ошибка удаления', 'error');
    }
  };

  const onSave = async () => {
    if (!student || !form) return;
    const phones = form.phones.split(',').map((p: string) => p.trim()).filter(Boolean);
    try {
      await updateStudent(student.id, {
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
    if (!file || !student) return;
    try {
      await uploadPhoto(student.id, file);
      toast('Фото загружено', 'success');
      await reload();
    } catch (err: any) {
      toast(err?.response?.data?.message || 'Ошибка загрузки', 'error');
    }
  };

  if (error) return <div className="error-banner">{error}</div>;
  if (!app) return <div className="empty">Загрузка...</div>;

  const isNew = app.status === 'NEW';
  const isAdmin = me?.role === 'ADMIN';
  const assigned = !!app.managerId || !!app.chinaManagerId;
  const isMine = !assigned || app.managerId === me?.id || app.chinaManagerId === me?.id;
  const canAct = isAdmin || isMine;
  const canEdit = app.status === 'IN_PROGRESS' && student && canAct;
  const uploadedTypes = new Set((student?.documents || []).map((d) => d.type).filter((t) => t && t !== 'OTHER'));
  const missingDocs = REQUIRED_DOCUMENTS.filter((r) => !uploadedTypes.has(r.type));
  const canComplete = missingDocs.length === 0;

  const handleComplete = () => {
    if (!canComplete) {
      toast(`Загрузите все документы (не хватает: ${missingDocs.length})`, 'error');
      return;
    }
    onStatus('COMPLETED');
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{app.fullName}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={`badge ${STATUS_BADGE[app.status]}`}>{STATUS_LABEL[app.status]}</span>
          {isNew && canAct && (
            <button className="btn btn-sm btn-primary" onClick={() => onStatus('IN_PROGRESS')}>
              Взять в работу
            </button>
          )}
          {app.status === 'IN_PROGRESS' && canAct && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={handleComplete}
              disabled={!canComplete}
              title={canComplete ? 'Завершить заявку' : `Загрузите все документы (не хватает: ${missingDocs.length})`}
              style={!canComplete ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              {canComplete ? 'Завершить' : `Завершить (${10 - missingDocs.length}/10)`}
            </button>
          )}
          {canEdit && !edit && (
            <button className="btn btn-sm btn-secondary" onClick={() => setEdit(true)}>
              Редактировать
            </button>
          )}
          {canEdit && edit && (
            <>
              <button className="btn btn-sm btn-secondary" onClick={() => { setEdit(false); reload(); }}>Отмена</button>
              <button className="btn btn-sm btn-primary" onClick={onSave}>Сохранить</button>
            </>
          )}
          {canAct && (
            <button className="btn btn-sm btn-danger" onClick={onDeleteApp}>Удалить</button>
          )}
        </div>
      </div>

      <div className="card-body">
        {!isNew && (
          <ManagerBar
            manager={app.manager}
            chinaManager={app.chinaManager}
            onReassign={onReassign}
          />
        )}

        {isNew && (
          <>
            <div className="detail-row"><div className="detail-label">Телефон</div><div className="detail-value">{app.phone}</div></div>
            <div className="detail-row"><div className="detail-label">Email</div><div className="detail-value">{app.email || '—'}</div></div>
            <div className="detail-row"><div className="detail-label">Направление</div><div className="detail-value">{DIRECTION_LABEL[app.direction]}</div></div>
            <div className="detail-row"><div className="detail-label">Комментарий</div><div className="detail-value">{app.comment || '—'}</div></div>
            <div className="detail-row"><div className="detail-label">Создана</div><div className="detail-value">{new Date(app.createdAt).toLocaleString('ru-RU')}</div></div>
          </>
        )}

        {!isNew && student && form && (
          <>
            <div className="detail-grid">
              <div>
                <div className="detail-photo">
                  {student.photoUrl
                    ? <img src={`${API_BASE}${student.photoUrl}`} alt="" />
                    : <Icon name="person" size={80} style={{ color: 'var(--text-light)' }} />}
                </div>
                {canEdit && (
                  <>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ width: '100%', marginTop: 8 }}
                      onClick={() => photoRef.current?.click()}
                    >
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
                    <div className="detail-row"><div className="detail-label">Статус студента</div><div className="detail-value">{STUDENT_STATUS_LABEL[student.status]}</div></div>
                    <div className="detail-row"><div className="detail-label">Комментарий</div><div className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>{student.comment || '—'}</div></div>
                    <div className="detail-row"><div className="detail-label">Создана заявка</div><div className="detail-value">{new Date(app.createdAt).toLocaleString('ru-RU')}</div></div>
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
                      <label>Статус студента</label>
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
              editable={!!canEdit}
            />
          </>
        )}
      </div>
    </div>
  );
}
