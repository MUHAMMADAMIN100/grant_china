import { api } from './client';
import type { ApplicationStatus } from './types';

// ============================================================================
// ТЗ 6.4 — единое окно диалогов. Контракт зеркалит backend/src/messaging/.
// ============================================================================

export interface ChannelOption {
  value: string;
  label: string;
  /** false — канал только принимает сообщения, поле ответа прячем. */
  outbound: boolean;
}

export interface Conversation {
  id: string;
  channel: string;
  externalId: string;
  title: string | null;
  username: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  studentId: string | null;
  student: { id: string; fullName: string; managerId: string | null; chinaManagerId: string | null } | null;
  applicationId: string | null;
  application: {
    id: string;
    fullName: string;
    status: ApplicationStatus;
    managerId: string | null;
    chinaManagerId: string | null;
  } | null;
  assignedToId: string | null;
  assignedTo: { id: string; fullName: string } | null;
  lastMessageAt: string;
  lastMessageText: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelMessageAttachment {
  type: string;
  fileId: string;
  name?: string;
}

export interface ChannelMessage {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  text: string | null;
  attachments: ChannelMessageAttachment[] | null;
  externalId: string | null;
  authorId: string | null;
  author: { id: string; fullName: string } | null;
  sentAt: string;
  createdAt: string;
}

export interface ConversationsPage {
  items: Conversation[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listChannels() {
  const { data } = await api.get<{ items: ChannelOption[]; telegramEnabled: boolean }>('/messaging/channels');
  return data;
}

export async function listConversations(
  filters: { mine?: boolean; unread?: boolean; channel?: string; search?: string; page?: number; pageSize?: number } = {},
) {
  const { data } = await api.get<ConversationsPage>('/messaging/conversations', {
    params: {
      ...filters,
      mine: filters.mine ? 'true' : undefined,
      unread: filters.unread ? 'true' : undefined,
    },
  });
  return data;
}

export async function conversationsUnreadCount() {
  const { data } = await api.get<{ count: number }>('/messaging/conversations/unread-count');
  return data;
}

export async function getConversation(id: string) {
  const { data } = await api.get<Conversation>(`/messaging/conversations/${id}`);
  return data;
}

/**
 * Страница 1 — ПОСЛЕДНИЕ сообщения диалога, страница 2 — предыдущие и так
 * вглубь. Внутри страницы порядок всегда хронологический: разворот делает
 * бэкенд, клиенту переворачивать массив не нужно.
 */
export async function listConversationMessages(id: string, params: { page?: number; pageSize?: number } = {}) {
  const { data } = await api.get<{ items: ChannelMessage[]; total: number; page: number; pageSize: number }>(
    `/messaging/conversations/${id}/messages`,
    { params },
  );
  return data;
}

export async function sendConversationMessage(id: string, text: string) {
  const { data } = await api.post<ChannelMessage>(`/messaging/conversations/${id}/messages`, { text });
  return data;
}

export async function markConversationRead(id: string) {
  const { data } = await api.post<{ ok: true }>(`/messaging/conversations/${id}/read`);
  return data;
}

/** Пустая строка = отвязать от карточки. */
export async function linkConversation(id: string, payload: { studentId?: string; applicationId?: string }) {
  const { data } = await api.patch<Conversation>(`/messaging/conversations/${id}/link`, payload);
  return data;
}

/** Пустая строка = снять ответственного. */
export async function assignConversation(id: string, assignedToId: string) {
  const { data } = await api.patch<Conversation>(`/messaging/conversations/${id}/assign`, { assignedToId });
  return data;
}
