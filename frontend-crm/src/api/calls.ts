import { api } from './client';
import type { ApplicationStatus } from './types';

// ============================================================================
// ТЗ 6.2 — IP-телефония и журнал звонков. Контракт зеркалит backend/src/calls/.
// ============================================================================

export type CallDirection = 'INBOUND' | 'OUTBOUND';
export type CallStatus = 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'FAILED' | 'CANCELED' | 'VOICEMAIL';

export const CALL_DIRECTION_LABEL: Record<CallDirection, string> = {
  INBOUND: 'Входящий',
  OUTBOUND: 'Исходящий',
};

export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  COMPLETED: 'Разговор состоялся',
  NO_ANSWER: 'Не ответили',
  BUSY: 'Занято',
  FAILED: 'Недоступен',
  CANCELED: 'Отменён',
  VOICEMAIL: 'Автоответчик',
};

export const CALL_STATUS_BADGE: Record<CallStatus, string> = {
  COMPLETED: 'badge-success',
  NO_ANSWER: 'badge-warning',
  BUSY: 'badge-warning',
  FAILED: 'badge-danger',
  CANCELED: 'badge-gray',
  VOICEMAIL: 'badge-info',
};

export const CALL_STATUS_OPTIONS: CallStatus[] = [
  'COMPLETED',
  'NO_ANSWER',
  'BUSY',
  'FAILED',
  'CANCELED',
  'VOICEMAIL',
];

export interface Call {
  id: string;
  provider: string;
  externalId: string | null;
  direction: CallDirection;
  status: CallStatus;
  phone: string;
  line: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number;
  recordingUrl: string | null;
  userId: string | null;
  user: { id: string; fullName: string } | null;
  studentId: string | null;
  student: { id: string; fullName: string } | null;
  applicationId: string | null;
  application: { id: string; fullName: string } | null;
  consultationId: string | null;
  comment: string | null;
  createdAt: string;
  /** Сырой payload АТС. Приходит ТОЛЬКО Основателю — у остальных поля нет вовсе. */
  raw?: unknown;
}

export interface CallsPage {
  items: Call[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listCalls(
  filters: {
    studentId?: string;
    applicationId?: string;
    userId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const { data } = await api.get<CallsPage>('/calls', { params: filters });
  return data;
}

export async function getCall(id: string) {
  const { data } = await api.get<Call>(`/calls/${id}`);
  return data;
}

/** Кандидаты на привязку — когда номер совпал с несколькими карточками. */
export interface CallResolveCandidate {
  kind: 'student' | 'application';
  id: string;
  fullName: string;
}

export interface CallResolveResult {
  normalized: string | null;
  student: { id: string; fullName: string; managerId: string | null; chinaManagerId: string | null } | null;
  application: {
    id: string;
    fullName: string;
    status: ApplicationStatus;
    studentId: string | null;
    managerId: string | null;
    chinaManagerId: string | null;
  } | null;
  candidates: CallResolveCandidate[];
}

/** «Кто звонит» по номеру — для всплывающей карточки и формы фиксации звонка. */
export async function resolveCaller(phone: string) {
  const { data } = await api.get<CallResolveResult>('/calls/resolve', { params: { phone } });
  return data;
}

export interface CreateCallPayload {
  phone: string;
  direction: CallDirection;
  status?: CallStatus;
  startedAt?: string;
  durationSec?: number;
  comment?: string;
  studentId?: string;
  applicationId?: string;
  consultationId?: string;
}

export async function logCall(payload: CreateCallPayload) {
  const { data } = await api.post<Call>('/calls', payload);
  return data;
}

export async function updateCall(
  id: string,
  payload: { comment?: string; status?: CallStatus; studentId?: string; applicationId?: string },
) {
  const { data } = await api.patch<Call>(`/calls/${id}`, payload);
  return data;
}

/**
 * ТЗ 6.2 «Click-to-Call». Открывает набор номера тем приложением, которое
 * настроено в системе сотрудника (софтфон, мобильный, Skype). Это работает
 * без подключения АТС — а когда АТС появится, тот же клик можно будет
 * заменить серверным вызовом, не трогая интерфейс.
 */
export function dialPhone(phone: string): void {
  const clean = phone.replace(/[^\d+]/g, '');
  if (!clean) return;
  window.location.href = `tel:${clean}`;
}
