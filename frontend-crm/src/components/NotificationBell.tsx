import { useEffect, useState } from 'react';
import { listNotifications, markAllRead, markRead, unreadCount } from '../api/notifications';
import type { Notification } from '../api/types';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);

  const refreshCount = async () => {
    try { setCount(await unreadCount()); } catch {}
  };

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (open) {
      listNotifications().then(setItems).catch(() => {});
    }
  }, [open]);

  const onItemClick = async (n: Notification) => {
    if (!n.read) {
      await markRead(n.id).catch(() => {});
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      refreshCount();
    }
  };

  const onMarkAll = async () => {
    await markAllRead();
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    setCount(0);
  };

  return (
    <>
      <button className="notif-button" onClick={() => setOpen(!open)} title="Уведомления">
        🔔
        {count > 0 && <span className="notif-badge">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span>Уведомления</span>
            {items.some((i) => !i.read) && (
              <button className="btn btn-sm btn-secondary" onClick={onMarkAll}>Прочитать все</button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="notif-empty">Уведомлений пока нет</div>
          ) : (
            items.map((n) => (
              <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => onItemClick(n)}>
                <div className="notif-item-title">{n.title}</div>
                <div className="notif-item-msg">{n.message}</div>
                <div className="notif-item-time">{new Date(n.createdAt).toLocaleString('ru-RU')}</div>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
