import { api } from './client';

// ============================================================================
// Раздел «Билеты» (волна 8). Контракт зеркалит backend/src/tickets/.
// ============================================================================

export type TicketStatus = 'BOOKED' | 'PURCHASED' | 'CHANGED' | 'CANCELLED';

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  BOOKED: 'Забронирован',
  PURCHASED: 'Выкуплен',
  CHANGED: 'Изменён',
  CANCELLED: 'Отменён',
};

export const TICKET_STATUS_BADGE: Record<TicketStatus, string> = {
  BOOKED: 'badge-warning',
  PURCHASED: 'badge-success',
  CHANGED: 'badge-info',
  CANCELLED: 'badge-gray',
};

export const TICKET_STATUS_OPTIONS: TicketStatus[] = ['BOOKED', 'PURCHASED', 'CHANGED', 'CANCELLED'];

export interface TicketStudentRef {
  id: string;
  fullName: string;
  phones: string[];
  managerId: string | null;
  chinaManagerId: string | null;
}

export interface TicketDocument {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  studentId: string;
  student: TicketStudentRef;
  destinationCity: string;
  departureAt: string;
  arrivalAt: string | null;
  flightNumber: string;
  airline: string | null;
  status: TicketStatus;
  comment: string | null;
  documents: TicketDocument[];
  createdById: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketFilters {
  status?: TicketStatus;
  /** Точное совпадение по городу назначения (выбор из справочника). */
  city?: string;
  studentId?: string;
  /** Диапазон по дате вылета — ISO-строки. */
  from?: string;
  to?: string;
  /** Поиск по ФИО студента, номеру рейса и авиакомпании. */
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TicketsPage {
  items: Ticket[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listTickets(filters: TicketFilters = {}) {
  const { data } = await api.get<TicketsPage>('/tickets', { params: filters });
  return data;
}

export interface TicketStats {
  total: number;
  upcoming7: number;
  upcoming30: number;
  booked: number;
  cancelled: number;
}

export async function ticketStats() {
  const { data } = await api.get<TicketStats>('/tickets/stats');
  return data;
}

export interface ChinaCity {
  value: string;
  latin: string;
}

export async function listChinaCities() {
  const { data } = await api.get<{ items: ChinaCity[] }>('/tickets/cities');
  return data.items;
}

export async function getTicket(id: string) {
  const { data } = await api.get<Ticket>(`/tickets/${id}`);
  return data;
}

export interface TicketPayload {
  studentId: string;
  destinationCity: string;
  /** ISO-строка. Фронт получает её как new Date(datetime-local).toISOString(). */
  departureAt: string;
  arrivalAt?: string;
  flightNumber: string;
  airline?: string;
  status?: TicketStatus;
  comment?: string;
}

/**
 * Создание идёт multipart, потому что маршрутную квитанцию прикладывают сразу
 * при заведении билета (это основной сценарий). Файл опционален — тогда
 * отправляется только текстовая часть.
 */
export async function createTicket(payload: TicketPayload, file?: File | null) {
  const form = new FormData();
  Object.entries(payload).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
  });
  if (file) form.append('file', file);
  const { data } = await api.post<Ticket>('/tickets', form);
  return data;
}

export interface UpdateTicketPayload {
  destinationCity?: string;
  departureAt?: string;
  /** Пустая строка = стереть дату прилёта (см. UpdateTicketDto на бэкенде). */
  arrivalAt?: string;
  flightNumber?: string;
  airline?: string;
  status?: TicketStatus;
  comment?: string;
}

export async function updateTicket(id: string, payload: UpdateTicketPayload) {
  const { data } = await api.patch<Ticket>(`/tickets/${id}`, payload);
  return data;
}

/** Удаление доступно только FOUNDER/ADMIN — бэкенд проверяет ролью. */
export async function deleteTicket(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/tickets/${id}`);
  return data;
}

export async function uploadTicketDocument(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<TicketDocument>(`/tickets/${id}/documents`, form);
  return data;
}

export async function deleteTicketDocument(docId: string) {
  const { data } = await api.delete<{ ok: true }>(`/tickets/documents/${docId}`);
  return data;
}
