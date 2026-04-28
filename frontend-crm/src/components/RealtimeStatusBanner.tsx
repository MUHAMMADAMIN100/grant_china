import { AnimatePresence, motion } from 'framer-motion';
import { useRealtimeConnState } from '../realtime';

/**
 * Тонкий тостер-индикатор состояния realtime-соединения.
 * Не показывается при connected. На disconnected/reconnecting — мягкое
 * сообщение в правом нижнем углу.
 */
export default function RealtimeStatusBanner() {
  const state = useRealtimeConnState();

  return (
    <AnimatePresence>
      {state !== 'connected' && (
        <motion.div
          className="rt-status"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25 }}
        >
          <span className="rt-status-dot" />
          {state === 'reconnecting'
            ? 'Соединение потеряно, переподключаемся…'
            : 'Нет соединения с сервером'}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
