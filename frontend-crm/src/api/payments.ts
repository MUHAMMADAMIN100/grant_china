import { api } from './client';
import type {
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentPurpose,
  PaymentScheduleRow,
  PaymentStage,
  PaymentStatus,
  PaymentSummary,
} from './types';
import type { Document } from './types';

export interface PaymentFilters {
  studentId?: string;
  status?: PaymentStatus;
  stage?: PaymentStage;
  kind?: PaymentKind;
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
  /** Игнорируется бэкендом для EMPLOYEE — он всегда сужен до своих студентов. */
  managerId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PaymentsPage {
  items: Payment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PendingPaymentsPage extends PaymentsPage {
  totalAmount: string;
}

export async function listPayments(filters: PaymentFilters = {}) {
  const { data } = await api.get<PaymentsPage>('/payments', { params: filters });
  return data;
}

export async function listPendingPayments(filters: { page?: number; pageSize?: number } = {}) {
  const { data } = await api.get<PendingPaymentsPage>('/payments/pending', { params: filters });
  return data;
}

export async function pendingPaymentsCount() {
  const { data } = await api.get<{ count: number; totalAmount: string }>('/payments/pending/count');
  return data;
}

export async function getPaymentsSummary(studentId: string) {
  const { data } = await api.get<PaymentSummary>('/payments/summary', { params: { studentId } });
  return data;
}

export async function getPaymentSchedule(studentId: string) {
  const { data } = await api.get<PaymentScheduleRow[]>('/payments/schedule', { params: { studentId } });
  return data;
}

export interface SetSchedulePayload {
  studentId: string;
  stage: PaymentStage;
  plannedAmount: string;
  dueDate?: string;
  comment?: string;
}

export async function setPaymentSchedule(payload: SetSchedulePayload) {
  const { data } = await api.put<PaymentScheduleRow>('/payments/schedule', payload);
  return data;
}

export async function getPayment(id: string) {
  const { data } = await api.get<Payment>(`/payments/${id}`);
  return data;
}

export interface CreatePaymentPayload {
  studentId: string;
  stage: PaymentStage;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amount: string;
  paidAt?: string;
  reference?: string;
  comment?: string;
  /** true — сразу отправить на одобрение Основателю (кнопка «Подтвердить»). */
  submit?: boolean;
  /** Чек — обязателен для Проживания/Питания и для submit=true (проверяет бэкенд). */
  file?: File | null;
}

export async function createPayment(payload: CreatePaymentPayload) {
  const fd = new FormData();
  fd.append('studentId', payload.studentId);
  fd.append('stage', payload.stage);
  fd.append('purpose', payload.purpose);
  fd.append('method', payload.method);
  fd.append('amount', payload.amount);
  if (payload.paidAt) fd.append('paidAt', payload.paidAt);
  if (payload.reference) fd.append('reference', payload.reference);
  if (payload.comment) fd.append('comment', payload.comment);
  if (payload.submit) fd.append('submit', 'true');
  if (payload.file) fd.append('file', payload.file);
  const { data } = await api.post<Payment>('/payments', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export interface UpdatePaymentPayload {
  stage?: PaymentStage;
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
  amount?: string;
  paidAt?: string;
  reference?: string;
  comment?: string;
}

/** Только DRAFT/REJECTED — PENDING_APPROVAL/APPROVED/VOID редактировать нельзя, бэкенд вернёт 409. */
export async function updatePayment(id: string, payload: UpdatePaymentPayload) {
  const { data } = await api.patch<Payment>(`/payments/${id}`, payload);
  return data;
}

/** DRAFT|REJECTED -> PENDING_APPROVAL. Требует хотя бы один живой чек. */
export async function submitPayment(id: string) {
  const { data } = await api.post<Payment>(`/payments/${id}/submit`);
  return data;
}

/** PENDING_APPROVAL -> DRAFT. Только тот, кто подавал, либо ADMIN/FOUNDER. */
export async function recallPayment(id: string) {
  const { data } = await api.post<Payment>(`/payments/${id}/recall`);
  return data;
}

/**
 * PENDING_APPROVAL -> APPROVED. Только FOUNDER. updatedAt — ISO-строка,
 * которую клиент видел при открытии карточки (optimistic-concurrency check
 * бэкенда: если платёж успели изменить — 409, а не тихий двойной акцепт).
 */
export async function approvePayment(id: string, updatedAt?: string) {
  const { data } = await api.post<Payment>(`/payments/${id}/approve`, { updatedAt });
  return data;
}

/** PENDING_APPROVAL -> REJECTED. Только FOUNDER, причина обязательна (мин. 5 символов). */
export async function rejectPayment(id: string, reason: string) {
  const { data } = await api.post<Payment>(`/payments/${id}/reject`, { reason });
  return data;
}

/** APPROVED -> VOID (сторно). Только FOUNDER, причина обязательна. */
export async function voidPayment(id: string, reason: string) {
  const { data } = await api.post<Payment>(`/payments/${id}/void`, { reason });
  return data;
}

/** Soft-delete. Только DRAFT/REJECTED. */
export async function deletePayment(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/payments/${id}`);
  return data;
}

/** Догрузить ещё один чек к уже существующему DRAFT/REJECTED платежу. */
export async function addPaymentReceipt(id: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post<Document>(`/payments/${id}/receipts`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function removePaymentReceipt(docId: string) {
  const { data } = await api.delete<{ ok: true }>(`/payments/receipts/${docId}`);
  return data;
}
