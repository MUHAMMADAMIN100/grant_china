import { useEffect, useState } from 'react';
import { applicationStats } from '../api/applications';
import { studentStats } from '../api/students';
import { DIRECTION_LABEL, STATUS_LABEL } from '../api/types';

export default function Dashboard() {
  const [appStats, setAppStats] = useState<any>(null);
  const [stuStats, setStuStats] = useState<any>(null);

  useEffect(() => {
    applicationStats().then(setAppStats).catch(() => {});
    studentStats().then(setStuStats).catch(() => {});
  }, []);

  const newCount = appStats?.byStatus?.find((s: any) => s.status === 'NEW')?._count || 0;
  const inProgress = appStats?.byStatus?.find((s: any) => s.status === 'IN_PROGRESS')?._count || 0;
  const completed = appStats?.byStatus?.find((s: any) => s.status === 'COMPLETED')?._count || 0;

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-row">
            <div>
              <div className="stat-label">Всего заявок</div>
              <div className="stat-value">{appStats?.total ?? '—'}</div>
            </div>
            <div className="stat-icon" style={{ background: '#eff6ff' }}>📝</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-row">
            <div>
              <div className="stat-label">Новые</div>
              <div className="stat-value" style={{ color: '#3b82f6' }}>{newCount}</div>
            </div>
            <div className="stat-icon" style={{ background: '#eff6ff' }}>🆕</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-row">
            <div>
              <div className="stat-label">В работе</div>
              <div className="stat-value" style={{ color: '#f59e0b' }}>{inProgress}</div>
            </div>
            <div className="stat-icon" style={{ background: '#fffbeb' }}>⚙️</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-row">
            <div>
              <div className="stat-label">Завершено</div>
              <div className="stat-value" style={{ color: '#10b981' }}>{completed}</div>
            </div>
            <div className="stat-icon" style={{ background: '#ecfdf5' }}>✅</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-row">
            <div>
              <div className="stat-label">Всего студентов</div>
              <div className="stat-value">{stuStats?.total ?? '—'}</div>
            </div>
            <div className="stat-icon" style={{ background: '#fff0f0' }}>🎓</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <div className="card">
          <div className="card-header"><h2 className="card-title">Заявки по направлениям</h2></div>
          <div className="card-body">
            {(appStats?.byDirection || []).map((d: any) => (
              <div key={d.direction} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span>{DIRECTION_LABEL[d.direction as keyof typeof DIRECTION_LABEL]}</span>
                <strong>{d._count}</strong>
              </div>
            ))}
            {!appStats?.byDirection?.length && <div className="empty">Нет данных</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="card-title">Студенты по кабинетам</h2></div>
          <div className="card-body">
            {(stuStats?.byCabinet || []).map((c: any) => (
              <div key={c.cabinet} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span>Кабинет {c.cabinet}</span>
                <strong>{c._count}</strong>
              </div>
            ))}
            {!stuStats?.byCabinet?.length && <div className="empty">Нет данных</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="card-title">Статусы заявок</h2></div>
          <div className="card-body">
            {(appStats?.byStatus || []).map((s: any) => (
              <div key={s.status} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span>{STATUS_LABEL[s.status as keyof typeof STATUS_LABEL]}</span>
                <strong>{s._count}</strong>
              </div>
            ))}
            {!appStats?.byStatus?.length && <div className="empty">Нет данных</div>}
          </div>
        </div>
      </div>
    </>
  );
}
