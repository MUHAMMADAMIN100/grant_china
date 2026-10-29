import { api } from './client';
import { postMultipart } from './upload';
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
  /** 29.10.2026 — Instagram / WhatsApp: наш аккаунт, последнее сообщение клиента (окно 24 ч), фото клиента у нас. */
  accountId?: string | null;
  lastIncomingAt?: string | null;
  contactPicture?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 29.10.2026 — вложение сообщения Instagram / WhatsApp. */
export interface ChatAttachment {
  id: string;
  kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'STICKER' | 'SHARE' | 'REEL' | 'STORY' | 'LOCATION' | 'CONTACT' | 'UNSUPPORTED';
  mimeType: string | null;
  size: number | null;
  name: string | null;
  url: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  /** PENDING — ещё качается в фоне, DONE — лежит у нас, FAILED — не удалось. */
  downloadState: string | null;
  /** Есть ли файл у нас (сам путь наружу не нужен — отдаёт attachmentUrl). */
  storedName: string | null;
}

export type ChatStatus = 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface MetaChannelStatus {
  value: 'INSTAGRAM' | 'WHATSAPP';
  enabled: boolean;
  state: 'NOT_CONFIGURED' | 'MISCONFIGURED' | 'TOKEN_REFUSED' | 'CONNECTED';
  account: string | null;
  missing: string[];
  tokenExpiresAt: string | null;
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
  /** 29.10.2026 — Instagram / WhatsApp. */
  status?: ChatStatus | null;
  error?: string | null;
  errorDetail?: string | null;
  contactReaction?: string | null;
  deletedByContactAt?: string | null;
  chatAttachments?: ChatAttachment[];
}

export interface ConversationsPage {
  items: Conversation[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listChannels() {
  const { data } = await api.get<{ items: ChannelOption[]; telegramEnabled: boolean; meta?: MetaChannelStatus[] }>('/messaging/channels');
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

/** Instagram / WhatsApp режут длинный текст на части — тогда сервер вернёт массив. */
export async function sendConversationMessage(id: string, text: string) {
  const { data } = await api.post<ChannelMessage | ChannelMessage[]>(`/messaging/conversations/${id}/messages`, { text });
  return Array.isArray(data) ? data : [data];
}

// ---------------------------------------------------------------- 29.10.2026 — Instagram / WhatsApp

/** Файлы идут напрямую на сервер (upload.ts): прокси Vercel режет тела больше 10 МБ. */
export async function sendChatFile(id: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return postMultipart<ChannelMessage>(`/messaging/conversations/${id}/files`, fd);
}

export async function sendChatVoice(id: string, blob: Blob) {
  const fd = new FormData();
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  fd.append('file', blob, `voice.${ext}`);
  return postMultipart<ChannelMessage>(`/messaging/conversations/${id}/voice`, fd);
}

export async function sendChatLocation(id: string, payload: { latitude: number; longitude: number; name?: string; address?: string }) {
  const { data } = await api.post<ChannelMessage>(`/messaging/conversations/${id}/location`, payload);
  return data;
}

export async function retryChatMessage(messageId: string, text?: string) {
  const { data } = await api.post<ChannelMessage>(`/messaging/messages/${messageId}/retry`, text !== undefined ? { text } : {});
  return data;
}

export async function takeConversation(id: string) {
  const { data } = await api.post<{ ok: true }>(`/messaging/conversations/${id}/take`);
  return data;
}

export async function releaseConversation(id: string) {
  const { data } = await api.post<{ ok: true }>(`/messaging/conversations/${id}/release`);
  return data;
}

export async function createApplicationFromChat(id: string, payload: { fullName: string; phone: string; direction: string; comment?: string }) {
  const { data } = await api.post<{ applicationId: string }>(`/messaging/conversations/${id}/application`, payload);
  return data;
}

const apiBase = () => String(api.defaults.baseURL ?? '').replace(/\/+$/, '');
/** Файлы и фото клиента — с нашего сервера (по cookie), не с серверов Meta. */
export const attachmentUrl = (attachmentId: string) => `${apiBase()}/messaging/attachments/${attachmentId}`;
export const conversationPictureUrl = (conversationId: string) => `${apiBase()}/messaging/conversations/${conversationId}/picture`;

/** unreadCount — что осталось после отметки: в чужом чате Instagram/WhatsApp «прочитано» ставит только ответственный. */
export async function markConversationRead(id: string) {
  const { data } = await api.post<{ ok: true; unreadCount?: number }>(`/messaging/conversations/${id}/read`);
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
