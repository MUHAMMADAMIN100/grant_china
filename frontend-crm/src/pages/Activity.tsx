import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { listActivity, ACTIVITY_GROUPS, ACTIVITY_LABEL, type ActivityAction, type ActivityEntry } from '../api/activity';
import { ROLE_LABEL, type Role } from '../api/types';
import { useRealtime } from '../realtime';
import Icon from '../Icon';
import { toPeriodRange } from '../utils/datetime';

const ACTION_BADGE: Record<ActivityAction, string> = {
  STATUS_CHANGE: 'badge-info',
  STUDENT_UPDATE: 'badge-warning',
  STUDENT_CREATE: 'badge-success',
  STUDENT_DELETE: 'badge-danger',
  MANAGER_CHANGE: 'badge-warning',
  PROGRAM_CHANGE: 'badge-info',
  PAYMENT_CREATE: 'badge-info',
  PAYMENT_UPDATE: 'badge-warning',
  PAYMENT_SUBMIT: 'badge-warning',
  PAYMENT_RECALL: 'badge-gray',
  PAYMENT_APPROVE: 'badge-success',
  PAYMENT_REJECT: 'badge-danger',
  PAYMENT_VOID: 'badge-danger',
  PAYMENT_DELETE: 'badge-gray',
  PAYMENT_SCHEDULE_UPDATE: 'badge-info',
  USER_CREATE: 'badge-success',
  USER_ROLE_CHANGE: 'badge-warning',
  USER_DELETE: 'badge-danger',
  APPLICATION_ARCHIVE: 'badge-gray',
  APPLICATION_UNARCHIVE: 'badge-info',
  APPLICATION_SOURCE_CHANGE: 'badge-info',
  APPLICATION_CLEAR_REPEAT: 'badge-gray',
  CONSULTATION_CREATE: 'badge-success',
  CONSULTATION_UPDATE: 'badge-warning',
  CONSULTATION_DELETE: 'badge-gray',
  CONSULTATION_CONVERT: 'badge-success',
  TASK_AUTO_CREATE: 'badge-info',
  TASK_CREATE: 'badge-success',
  PAYMENT_RECEIPT_ADD: 'badge-success',
  PAYMENT_RECEIPT_REMOVE: 'badge-gray',
  DOCUMENT_UPLOAD: 'badge-info',
  DOCUMENT_DELETE: 'badge-gray',
  COMMENT_CREATE: 'badge-info',
  COMMENT_UPDATE: 'badge-gray',
  COMMENT_DELETE: 'badge-gray',
  CALL_LOGGED: 'badge-info',
  GRANT_CREATE: 'badge-success',
  GRANT_UPDATE: 'badge-warning',
  GRANT_YEAR_ADVANCE: 'badge-success',
  GRANT_CLOSE: 'badge-gray',
};

export default function Activity() {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ActivityAction | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    setLoading(true);
    setError(null);
    listActivity({
      action: action || undefined,
      ...toPeriodRange(from, to),
    })
      .then(setItems)
      .catch((e: any) => {
        setItems([]);
        setError(e?.response?.data?.message || 'Не удалось загрузить журнал активности');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [action, from, to]);

  // Раздел 6.3 (волна 4) кратно увеличивает число типов событий — 'activity:new'
  // на каждое из них раньше перезапрашивало журнал целиком СРАЗУ. При активной
  // работе нескольких менеджеров это давало несколько полных перезагрузок
  // списка в минуту. Схлопываем события за 2 секунды в один load() —
  // тот же приём, что scheduleReload в pages/Students.tsx.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime({
    'activity:new': () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        load();
      }, 2000);
    },
  });

  const reset = () => {
    setAction('');
    setFrom('');
    setTo('');
  };

  return (
    <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="card-header">
        <h2 className="card-title">Активность менеджеров</h2>
        <button className="btn btn-secondary btn-sm" onClick={reset}>
          <Icon name="filter_alt_off" size={16} style={{ marginRight: 4 }} /> Сброс
        </button>
      </div>
      <div className="card-body">
        <div className="filters">
          <select value={action} onChange={(e) => setAction(e.target.value as any)}>
            <option value="">Все действия</option>
            {ACTIVITY_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.actions.map((a) => (
                  <option key={a} value={a}>{ACTIVITY_LABEL[a]}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="От"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="До"
          />
        </div>

        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <div className="empty">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Icon name="history" size={48} /></div>
            Ничего не найдено
          </div>
        ) : (
          <div className="activity-list">
            {items.map((e) => (
              <motion.div
                key={e.id}
                className="activity-item"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="activity-item-head">
                  <span className={`badge ${ACTION_BADGE[e.action]}`}>{ACTIVITY_LABEL[e.action]}</span>
                  <span className="activity-time">{new Date(e.createdAt).toLocaleString('ru-RU')}</span>
                </div>
                <div className="activity-actor">
                  <Icon name="person" size={14} /> {e.actorName} <span className="activity-role">({ROLE_LABEL[e.actorRole as Role] || e.actorRole})</span>
                </div>
                {e.studentName && (
                  <div className="activity-student">
                    <Icon name="school" size={14} /> {e.studentName}
                  </div>
                )}
                <div className="activity-details">{e.details}</div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
