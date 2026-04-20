import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { convertApplication, deleteApplication, getApplication, updateApplication } from '../api/applications';
import type { Application, ApplicationStatus } from '../api/types';
import { DIRECTION_LABEL, STATUS_BADGE, STATUS_LABEL } from '../api/types';
import { useUI } from '../ui/Dialogs';

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm, toast } = useUI();
  const [app, setApp] = useState<Application | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) getApplication(id).then(setApp).catch((e) => setError(e.message));
  }, [id]);

  const onStatus = async (status: ApplicationStatus) => {
    if (!id) return;
    const upd = await updateApplication(id, { status });
    setApp(upd);
  };

  const onConvert = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Конвертация заявки',
      message: 'Сконвертировать заявку в студента? Заявка будет помечена как завершённая.',
      confirmText: 'Конвертировать',
    });
    if (!ok) return;
    try {
      const student = await convertApplication(id);
      toast('Студент создан', 'success');
      navigate(`/students/${student.id}`);
    } catch (e: any) {
      toast(e.response?.data?.message || 'Ошибка конвертации', 'error');
    }
  };

  const onDelete = async () => {
    if (!id) return;
    const ok = await confirm({
      title: 'Удалить заявку',
      message: 'Действие нельзя отменить. Вы уверены?',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    await deleteApplication(id);
    toast('Заявка удалена', 'success');
    navigate('/applications');
  };

  if (error) return <div className="error-banner">{error}</div>;
  if (!app) return <div className="empty">Загрузка...</div>;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{app.fullName}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${STATUS_BADGE[app.status]}`}>{STATUS_LABEL[app.status]}</span>
          {app.status !== 'IN_PROGRESS' && app.status !== 'COMPLETED' && (
            <button className="btn btn-sm btn-secondary" onClick={() => onStatus('IN_PROGRESS')}>Взять в работу</button>
          )}
          {app.status !== 'COMPLETED' && (
            <button className="btn btn-sm btn-secondary" onClick={() => onStatus('COMPLETED')}>Завершить</button>
          )}
          {!app.studentId && (
            <button className="btn btn-sm btn-primary" onClick={onConvert}>В студенты</button>
          )}
          <button className="btn btn-sm btn-danger" onClick={onDelete}>Удалить</button>
        </div>
      </div>
      <div className="card-body">
        <div className="detail-row"><div className="detail-label">Телефон</div><div className="detail-value">{app.phone}</div></div>
        <div className="detail-row"><div className="detail-label">Email</div><div className="detail-value">{app.email || '—'}</div></div>
        <div className="detail-row"><div className="detail-label">Направление</div><div className="detail-value">{DIRECTION_LABEL[app.direction]}</div></div>
        <div className="detail-row"><div className="detail-label">Комментарий</div><div className="detail-value">{app.comment || '—'}</div></div>
        <div className="detail-row"><div className="detail-label">Создана</div><div className="detail-value">{new Date(app.createdAt).toLocaleString('ru-RU')}</div></div>
        {app.student && (
          <div className="detail-row">
            <div className="detail-label">Студент</div>
            <div className="detail-value">
              <a href={`/students/${app.student.id}`} style={{ color: '#d52b2b', fontWeight: 600 }}>{app.student.fullName}</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
