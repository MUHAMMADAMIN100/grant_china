import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getCall, type Call } from '../api/calls';
import { useRealtime } from '../realtime';
import Icon from '../Icon';

/** Через сколько карточка гаснет сама, если её не закрыли. */
const AUTO_HIDE_MS = 45_000;

/**
 * ТЗ 6.2 — «всплывающая карточка клиента при входящем звонке».
 *
 * Сокет приносит ТОЛЬКО идентификаторы (Проблема B аудита: PII не уезжает в
 * realtime-канал) — имя и телефон подтягиваются отдельным HTTP-запросом
 * GET /calls/:id, где права уже проверены. Если карточка чужая, бэкенд
 * ответит 404 и попап просто не покажется.
 *
 * Живёт в Layout, а не на конкретной странице: звонок застаёт менеджера где
 * угодно, и карточка должна всплыть поверх любого экрана.
 */
export default function IncomingCallPopup() {
  const [call, setCall] = useState<Call | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  useRealtime({
    'call:incoming': (payload: { callId?: string }) => {
      if (!payload?.callId) return;
      getCall(payload.callId)
        .then((data) => {
          setCall(data);
          clearHideTimer();
          hideTimerRef.current = setTimeout(() => setCall(null), AUTO_HIDE_MS);
        })
        // 404 = звонок не по нашей карточке. Молча игнорируем: это не ошибка,
        // а нормальная маршрутизация.
        .catch(() => {});
    },
  });

  useEffect(() => clearHideTimer, []);

  const close = () => {
    clearHideTimer();
    setCall(null);
  };

  const name = call?.student?.fullName || call?.application?.fullName || null;

  return (
    <AnimatePresence>
      {call && (
        <motion.div
          className="call-popup"
          initial={{ opacity: 0, x: 40, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.96 }}
          transition={{ duration: 0.25 }}
        >
          <div className="call-popup-head">
            <motion.span
              className="call-popup-icon"
              animate={{ rotate: [0, -12, 12, -12, 0] }}
              transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            >
              <Icon name="ring_volume" size={22} />
            </motion.span>
            <div className="call-popup-title">Входящий звонок</div>
            <button className="call-popup-close" onClick={close} title="Скрыть">
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="call-popup-body">
            <div className="call-popup-phone">{call.phone}</div>
            {name ? (
              <div className="call-popup-name">{name}</div>
            ) : (
              <div className="call-popup-unknown">
                Номер не найден в базе — новый лид или незнакомый контакт
              </div>
            )}
          </div>

          <div className="call-popup-actions">
            {call.studentId && (
              <Link to={`/students/${call.studentId}`} className="btn btn-sm btn-primary" onClick={close}>
                <Icon name="person" size={16} />
                Карточка студента
              </Link>
            )}
            {!call.studentId && call.applicationId && (
              <Link to={`/applications/${call.applicationId}`} className="btn btn-sm btn-primary" onClick={close}>
                <Icon name="description" size={16} />
                Открыть заявку
              </Link>
            )}
            {!call.studentId && !call.applicationId && (
              <Link to="/applications" className="btn btn-sm btn-secondary" onClick={close}>
                <Icon name="add" size={16} />
                Завести заявку
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
