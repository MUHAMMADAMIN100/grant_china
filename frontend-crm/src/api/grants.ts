import { api } from './client';
import type { StudentStatus } from './types';

// ============================================================================
// Раздел 4 ТЗ (волна 4) — реестр студентов с «двойным грантом» (Multi-Grant).
// Контракт зеркалит backend/src/grants/ (grants.controller.ts, grants.service.ts)
// и backend/prisma/schema.prisma (модель StudentGrant).
// ============================================================================

export type GrantStatus = 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'TERMINATED';

/** Набор, с которого стартует учебный год — вычисляется бэкендом из startDate, не редактируется. */
export type GrantIntake = 'SEPTEMBER' | 'FEBRUARY' | 'OTHER';

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  ACTIVE: 'Действует',
  SUSPENDED: 'Приостановлен',
  COMPLETED: 'Завершён',
  TERMINATED: 'Прекращён',
};

export const GRANT_STATUS_BADGE: Record<GrantStatus, string> = {
  ACTIVE: 'badge-success',
  SUSPENDED: 'badge-warning',
  COMPLETED: 'badge-info',
  TERMINATED: 'badge-danger',
};

export const GRANT_INTAKE_LABEL: Record<GrantIntake, string> = {
  SEPTEMBER: 'Сентябрьский набор',
  FEBRUARY: 'Февральский набор',
  OTHER: 'Другой набор',
};

/** '2-й', '3-й'... — короткая форма числительного для года обучения (не требует словаря). */
export function ordinalShortRu(n: number): string {
  return `${n}-й`;
}

export interface GrantStudentRef {
  id: string;
  fullName: string;
  managerId: string | null;
  chinaManagerId: string | null;
  status: StudentStatus;
}

export interface StudentGrant {
  id: string;
  studentId: string;
  student?: GrantStudentRef;
  name: string | null;
  university: string | null;
  totalYears: number;
  currentYear: number;
  /** Календарная дата (YYYY-MM-DD семантика), сериализована как ISO-момент полуночи по Душанбе. */
  startDate: string;
  intake: GrantIntake;
  /** Плановый старт следующего учебного года. null — грант завершён/прекращён/на последнем году. */
  nextYearStartsAt: string | null;
  reminderSentAt: string | null;
  status: GrantStatus;
  note: string | null;
  createdById: string | null;
  createdBy?: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface GrantFilters {
  /** По умолчанию true на бэкенде — реестр «двойных» (totalYears > 1). false — показать все, включая разовые. */
  multiOnly?: boolean;
  status?: GrantStatus;
  intake?: GrantIntake;
  managerId?: string;
  studentId?: string;
  search?: string;
  /** Ближайший старт следующего учебного года ≤ N дней. */
  dueInDays?: number;
  page?: number;
  pageSize?: number;
}

export interface GrantsPage {
  items: StudentGrant[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listGrants(filters: GrantFilters = {}) {
  const { data } = await api.get<GrantsPage>('/grants', { params: filters });
  return data;
}

export interface GrantStats {
  total: number;
  multi: number;
  activeThisYear: number;
  dueSoon60: number;
  withoutManager: number;
}

export async function grantStats() {
  const { data } = await api.get<GrantStats>('/grants/stats');
  return data;
}

export async function getGrant(id: string) {
  const { data } = await api.get<StudentGrant>(`/grants/${id}`);
  return data;
}

export interface GrantPayload {
  studentId: string;
  name?: string;
  university?: string;
  totalYears: number;
  currentYear?: number;
  /** 'YYYY-MM-DD' — как отдаёт <input type="date">. */
  startDate: string;
  nextYearStartsAt?: string;
  note?: string;
}

export async function createGrant(payload: GrantPayload) {
  const { data } = await api.post<StudentGrant>('/grants', payload);
  return data;
}

export interface UpdateGrantPayload {
  name?: string;
  university?: string;
  totalYears?: number;
  currentYear?: number;
  startDate?: string;
  /** null — явно очистить плановую дату (грант больше не ждёт следующего года). */
  nextYearStartsAt?: string | null;
  status?: GrantStatus;
  note?: string;
}

export async function updateGrant(id: string, payload: UpdateGrantPayload) {
  const { data } = await api.patch<StudentGrant>(`/grants/${id}`, payload);
  return data;
}

/** «Перевести на следующий год» — startsAt указывается, только если фактическая дата отличается от плановой. */
export async function advanceGrant(id: string, startsAt?: string) {
  const { data } = await api.post<StudentGrant>(`/grants/${id}/advance`, startsAt ? { startsAt } : {});
  return data;
}

/** Soft-delete (закрытие записи в реестре) — только FOUNDER/ADMIN, проверяет бэкенд. */
export async function deleteGrant(id: string) {
  const { data } = await api.delete<{ ok: true }>(`/grants/${id}`);
  return data;
}
