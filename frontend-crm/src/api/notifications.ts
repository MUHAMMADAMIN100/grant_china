import { api } from './client';
import type { Notification } from './types';

export async function listNotifications(unread = false) {
  const { data } = await api.get<Notification[]>('/notifications', { params: { unread } });
  return data;
}

export async function unreadCount() {
  const { data } = await api.get<{ count: number }>('/notifications/unread-count');
  return data.count;
}

export async function markRead(id: string) {
  await api.patch(`/notifications/${id}/read`);
}

export async function markAllRead() {
  await api.patch('/notifications/read-all');
}
