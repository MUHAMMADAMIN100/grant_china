import { api } from './client';
import type { Consultation, ConsultationKind, ConsultationOutcome, Direction } from './types';

export interface ConsultationFilters {
  /** ISO-строки (верхняя граница нормализуется вызывающим кодом, как у Application). */
  from?: string;
  to?: string;
  managerId?: string;
  kind?: ConsultationKind;
  outcome?: ConsultationOutcome;
  /** Значение справочника источников либо 'NONE' — «Не указан». */
  source?: string;
  search?: string;
  applicationId?: string;
  studentId?: string;
  mine?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ConsultationsPage {
  items: Consultation[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listConsultations(filters: ConsultationFilters = {}) {
  const { data } = await api.get<ConsultationsPage>('/consultations', { params: filters });
  return data;
}

export async function getConsultation(id: string) {
  const { data } = await api.get<Consultation>(`/consultations/${id}`);
  return data;
}

export interface ConsultationStats {
  total: number;
  consultations: number;
  interviews: number;
  /** Назначен повторный звонок, но результат ещё не зафиксирован. */
  pendingFollowUp: number;
}

export async function consultationStats() {
  const { data } = await api.get<ConsultationStats>('/consultations/stats');
  return data;
}

export interface ConsultationPayload {
  fullName: string;
  phone: string;
  purpose: string;
  kind?: ConsultationKind;
  source?: string;
  sourceDetail?: string;
  direction?: Direction;
  comment?: string;
  /** ISO-строка. Не указана — бэкенд подставит "сейчас". */
  heldAt?: string;
  /** ТЗ 3.2 — дата и время повторного звонка. При заполнении синхронно создаётся задача. */
  followUpAt?: string;
  applicationId?: string;
  studentId?: string;
  /** Назначить консультацию другому менеджеру может только FOUNDER/ADMIN (бэк проверяет). */
  managerId?: string;
}

export async function createConsultation(payload: ConsultationPayload) {
  const { data } = await api.post<Consultation>('/consultations', payload);
  return data;
}

export interface UpdateConsultationPayload extends Omit<Partial<ConsultationPayload>, 'followUpAt'> {
  outcome?: ConsultationOutcome;
  /** string — перенос даты звонка, null — отмена (снимает автозадачу, если она ещё TODO). */
  followUpAt?: string | null;
}

export async function updateConsultation(id: string, payload: UpdateConsultationPayload) {
  const { data } = await api.patch<Consultation>(`/consultations/${id}`, payload);
  return data;
}

/** Soft-delete. Гасит связанную автозадачу на повторный звонок, если она ещё не взята в работу. */
export async function deleteConsultation(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/consultations/${id}`);
  return data;
}

/** «Создать заявку из консультации». Идемпотентно — повторный вызов вернёт 409. */
export async function convertConsultation(id: string) {
  const { data } = await api.post<{ application: { id: string }; consultation: Consultation }>(
    `/consultations/${id}/convert`,
  );
  return data;
}
