import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { listNotifications, markAllRead, markRead, unreadCount } from '../api/notifications';
import type { Notification } from '../api/types';
import { useRealtime } from '../realtime';
import Icon from '../Icon';

function notificationHref(n: Notification): string | null {
  const p = n.payload || {};
  if (p.applicationId) return `/applications/${p.applicationId}`;
  if (p.studentId) return `/students/${p.studentId}`;
  if (p.taskId) return '/tasks';
  if (n.type === 'TASK_ASSIGNED') return '/tasks';
  if (n.type === 'APPLICATION_NEW') return '/applications';
  return null;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refreshCount = async () => {
    try { setCount(await unreadCount()); } catch {}
  };

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 30000);
    return () => clearInterval(t);
  }, []);

  useRealtime({
    'notification:new': () => {
      refreshCount();
      if (open) {
        listNotifications().then(setItems).catch(() => {});
      }
    },
  });

  useEffect(() => {
    if (open) {
      listNotifications().then(setItems).catch(() => {});
    }
  }, [open]);

  // Закрытие по клику вне панели/кнопки
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onItemClick = async (n: Notification) => {
    if (!n.read) {
      await markRead(n.id).catch(() => {});
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      refreshCount();
    }
    const href = notificationHref(n);
    if (href) {
      setOpen(false);
      navigate(href);
    }
  };

  const onMarkAll = async () => {
    await markAllRead();
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setCount(0);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <motion.button
        className="notif-button"
        onClick={() => setOpen(!open)}
        title="Уведомления"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        animate={count > 0 ? { rotate: [0, -12, 12, -8, 8, 0] } : {}}
        transition={count > 0 ? { duration: 0.6, repeat: Infinity, repeatDelay: 3 } : {}}
      >
        <Icon name="notifications" size={22} />
        <AnimatePresence>
          {count > 0 && (
            <motion.span
              className="notif-badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              key={count}
            >
              {count > 99 ? '99+' : count}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="notif-panel"
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="notif-panel-header">
              <span>Уведомления</span>
              {items.some((i) => !i.read) && (
                <motion.button
                  className="btn btn-sm btn-secondary"
                  onClick={onMarkAll}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Прочитать все
                </motion.button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="notif-empty">Уведомлений пока нет</div>
            ) : (
              <motion.div
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
              >
                {items.map((n) => (
                  <motion.div
                    key={n.id}
                    className={`notif-item${n.read ? '' : ' unread'}`}
                    onClick={() => onItemClick(n)}
                    variants={{
                      hidden: { opacity: 0, x: -10 },
                      show: { opacity: 1, x: 0 },
                    }}
                    whileHover={{ x: 4 }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-msg">{n.message}</div>
                    <div className="notif-item-time">{new Date(n.createdAt).toLocaleString('ru-RU')}</div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
