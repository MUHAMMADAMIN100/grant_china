import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CALL_DIRECTION_LABEL,
  CALL_STATUS_BADGE,
  CALL_STATUS_LABEL,
  dialPhone,
  listCalls,
  type Call,
} from '../api/calls';
import { useRealtime } from '../realtime';
import { formatDateTimeRu } from '../utils/datetime';
import CallLogModal from './CallLogModal';
import Icon from '../Icon';

type Props = {
  studentId?: string;
  applicationId?: string;
  /** Телефон карточки — для click-to-call и подстановки в форму записи звонка. */
  phone?: string;
  canEdit: boolean;
};

/**
 * ТЗ 6.2 — история звонков в карточке студента/заявки плюс click-to-call.
 *
 * Заказчик выбрал «пока каркас»: АТС ещё не подключена, поэтому основной путь
 * наполнения — кнопка «Записать звонок». Click-to-call при этом работает уже
 * сейчас: `tel:` открывает софтфон или мобильный, настроенный у сотрудника.
 * Когда появится вебхук провайдера, записи начнут приходить сюда сами — ни
 * таблицу, ни этот блок менять не придётся.
 */
export default function CallsCard({ studentId, applicationId, phone, canEdit }: Props) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [logOpen, setLogOpen] = useState(false);

  const load = () => {
    if (!studentId && !applicationId) return;
    setLoading(true);
    listCalls({ studentId, applicationId, pageSize: 20 })
      .then((res) => setCalls(res.items))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, applicationId]);

  useRealtime({
    'call:logged': (d: any) => {
      if ((studentId && d?.studentId === studentId) || (applicationId && d?.applicationId === applicationId)) load();
    },
  });

  const fmtDuration = (sec: number): string => {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m} мин ${s} сек` : `${s} сек`;
  };

  return (
    <div className="sub-card">
      <div className="sub-card-header">
        <div className="sub-card-title">
          <Icon name="call" size={18} style={{ marginRight: 6 }} />
          Звонки
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {phone && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => dialPhone(phone)}
              title="Позвонить через софтфон или мобильный"
            >
              <Icon name="phone_forwarded" size={15} style={{ marginRight: 4 }} />
              Позвонить
            </button>
          )}
          {canEdit && (
            <button className="btn btn-sm btn-secondary" onClick={() => setLogOpen(true)}>
              <Icon name="add" size={15} style={{ marginRight: 4 }} />
              Записать звонок
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="empty" style={{ padding: 16 }}>Загрузка...</div>
      ) : calls.length === 0 ? (
        <div className="sub-card-empty">Звонков пока нет</div>
      ) : (
        <div className="sub-card-list">
          {calls.map((c) => (
            <motion.div key={c.id} className="sub-item" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <div className="sub-item-head">
                <div className="sub-item-title">
                  <Icon
                    name={c.direction === 'INBOUND' ? 'call_received' : 'call_made'}
                    size={15}
                    style={{ marginRight: 6 }}
                  />
                  {CALL_DIRECTION_LABEL[c.direction]} · {c.phone}
                </div>
                <span className={`badge ${CALL_STATUS_BADGE[c.status]}`}>{CALL_STATUS_LABEL[c.status]}</span>
              </div>

              <div className="sub-item-figures">
                <div>
                  <span>Когда</span>
                  <strong>{formatDateTimeRu(c.startedAt)}</strong>
                </div>
                <div>
                  <span>Длительность</span>
                  <strong>{fmtDuration(c.durationSec)}</strong>
                </div>
                <div>
                  <span>Сотрудник</span>
                  <strong>{c.user?.fullName ?? '—'}</strong>
                </div>
              </div>

              {c.comment && <div className="sub-item-note">{c.comment}</div>}

              {c.recordingUrl && (
                <div className="sub-item-actions">
                  {/* Запись хранится у провайдера АТС — ссылку открываем как есть,
                      файл в /uploads не тянем (объёмы неконтролируемы). */}
                  <a
                    href={c.recordingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm btn-secondary"
                  >
                    <Icon name="play_circle" size={15} style={{ marginRight: 4 }} />
                    Прослушать запись
                  </a>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {logOpen && (
          <CallLogModal
            studentId={studentId}
            applicationId={applicationId}
            defaultPhone={phone}
            onClose={() => setLogOpen(false)}
            onSaved={load}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
