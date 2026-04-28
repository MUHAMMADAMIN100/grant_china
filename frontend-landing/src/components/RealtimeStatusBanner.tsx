import { AnimatePresence, motion } from 'framer-motion';
import { useRealtimeConnState } from '../realtime';

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
