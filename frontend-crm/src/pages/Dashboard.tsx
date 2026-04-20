import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { applicationStats } from '../api/applications';
import { studentStats } from '../api/students';
import { DIRECTION_LABEL, STATUS_LABEL } from '../api/types';
import { fadeUp, staggerContainer, listItem } from '../motion';
import Icon from '../Icon';

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

  const statCards = [
    { label: 'Всего заявок', value: appStats?.total ?? '—', color: '#3b82f6', bg: '#eff6ff', icon: 'assignment' },
    { label: 'Новые', value: newCount, color: '#3b82f6', bg: '#eff6ff', icon: 'fiber_new' },
    { label: 'В работе', value: inProgress, color: '#f59e0b', bg: '#fffbeb', icon: 'pending_actions' },
    { label: 'Завершено', value: completed, color: '#10b981', bg: '#ecfdf5', icon: 'task_alt' },
    { label: 'Всего студентов', value: stuStats?.total ?? '—', color: '#d52b2b', bg: '#fff0f0', icon: 'school' },
  ];

  return (
    <>
      <motion.div
        className="stats-grid"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {statCards.map((c) => (
          <motion.div
            key={c.label}
            className="stat-card"
            variants={fadeUp}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
          >
            <div className="stat-icon-row">
              <div>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value" style={c.color ? { color: c.color } : undefined}>
                  {c.value}
                </div>
              </div>
              <motion.div
                className="stat-icon"
                style={{ background: c.bg, color: c.color }}
                whileHover={{ scale: 1.15, rotate: 8 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <Icon name={c.icon} size={24} />
              </motion.div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div className="card" variants={fadeUp} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
          <div className="card-header"><h2 className="card-title">Заявки по направлениям</h2></div>
          <motion.div className="card-body" variants={staggerContainer} initial="hidden" animate="show">
            {(appStats?.byDirection || []).map((d: any) => (
              <motion.div
                key={d.direction}
                variants={listItem}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}
              >
                <span>{DIRECTION_LABEL[d.direction as keyof typeof DIRECTION_LABEL]}</span>
                <strong>{d._count}</strong>
              </motion.div>
            ))}
            {!appStats?.byDirection?.length && <div className="empty">Нет данных</div>}
          </motion.div>
        </motion.div>

        <motion.div className="card" variants={fadeUp} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
          <div className="card-header"><h2 className="card-title">Студенты по кабинетам</h2></div>
          <motion.div className="card-body" variants={staggerContainer} initial="hidden" animate="show">
            {(stuStats?.byCabinet || []).map((c: any) => (
              <motion.div
                key={c.cabinet}
                variants={listItem}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}
              >
                <span>Кабинет {c.cabinet}</span>
                <strong>{c._count}</strong>
              </motion.div>
            ))}
            {!stuStats?.byCabinet?.length && <div className="empty">Нет данных</div>}
          </motion.div>
        </motion.div>

        <motion.div className="card" variants={fadeUp} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
          <div className="card-header"><h2 className="card-title">Статусы заявок</h2></div>
          <motion.div className="card-body" variants={staggerContainer} initial="hidden" animate="show">
            {(appStats?.byStatus || []).map((s: any) => (
              <motion.div
                key={s.status}
                variants={listItem}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}
              >
                <span>{STATUS_LABEL[s.status as keyof typeof STATUS_LABEL]}</span>
                <strong>{s._count}</strong>
              </motion.div>
            ))}
            {!appStats?.byStatus?.length && <div className="empty">Нет данных</div>}
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
