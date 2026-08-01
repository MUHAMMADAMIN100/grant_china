import { api } from './client';
import type { Application, ApplicationStatus, ApplicationTab, Direction } from './types';

export interface AppFilters {
  status?: ApplicationStatus;
  direction?: Direction;
  search?: string;
  mine?: boolean;
  /** Фильтр по конкретному менеджеру (TJ или CN) — userId */
  manager?: string;
  /** ТЗ 3.1 — вкладки «Все» / «Новые» / «В работе» / «Архив». */
  tab?: ApplicationTab;
  /** Значение справочника источников либо 'NONE' — отдельный пункт «Не указан». */
  source?: string;
  /** ISO-строки, верхняя граница нормализуется вызывающим кодом (см. Activity.tsx). */
  from?: string;
  to?: string;
  /** true — только заявки с repeatOfId (повторные обращения). */
  repeat?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ApplicationsPage {
  items: Application[];
  total: number;
  page: number;
  pageSize: number;
}

/** ТЗ 3.1 — счётчики вкладок с учётом всех текущих фильтров, кроме tab. */
export interface ApplicationTabCounts {
  all: number;
  new: number;
  in_work: number;
  archive: number;
}

export async function listApplications(filters: AppFilters = {}) {
  const { data } = await api.get<Application[]>('/applications', { params: filters });
  return data;
}

export async function listApplicationsPaged(filters: AppFilters & { page: number; pageSize: number }) {
  const { data } = await api.get<ApplicationsPage>('/applications', { params: filters });
  return data;
}

export async function applicationTabCounts(filters: Omit<AppFilters, 'tab' | 'page' | 'pageSize'> = {}) {
  const { data } = await api.get<ApplicationTabCounts>('/applications/tab-counts', { params: filters });
  return data;
}

export async function getApplication(id: string) {
  const { data } = await api.get<Application>(`/applications/${id}`);
  return data;
}

export async function updateApplication(id: string, payload: Partial<Application>) {
  const { data } = await api.patch<Application>(`/applications/${id}`, payload);
  return data;
}

export async function assignApplicationManager(
  id: string,
  patch: { managerId?: string | null; chinaManagerId?: string | null },
) {
  const { data } = await api.patch<Application>(`/applications/${id}/manager`, patch);
  return data;
}

/** ТЗ 3.1 — ручной архив. Обратимо: не трогает deletedAt. */
export async function archiveApplication(id: string, reason?: string) {
  const { data } = await api.post<Application>(`/applications/${id}/archive`, { reason });
  return data;
}

export async function unarchiveApplication(id: string) {
  const { data } = await api.post<Application>(`/applications/${id}/unarchive`);
  return data;
}

/**
 * ТЗ 3.1 — снять ложную пометку «Повторное обращение». Эвристика по телефону
 * гарантированно ошибается на общем семейном номере (брат и сестра), и без
 * этой кнопки вторая заявка навсегда остаётся во вкладке «Архив» и искажает
 * её счётчик. Сбрасывает только repeatOfId, других последствий нет.
 */
export async function clearRepeatApplication(id: string) {
  const { data } = await api.post<Application>(`/applications/${id}/clear-repeat`);
  return data;
}

export async function deleteApplication(id: string) {
  const { data } = await api.delete(`/applications/${id}`);
  return data;
}

export async function applicationStats() {
  const { data } = await api.get('/applications/stats');
  return data;
}
