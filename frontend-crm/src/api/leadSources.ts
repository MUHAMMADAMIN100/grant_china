import { api } from './client';

/** 08.09.2026 — справочник источников привлечения: встроенные + свои (см. backend/src/lead-sources). */
export interface LeadSourceItem {
  code: string;
  label: string;
  builtin: boolean;
  hidden: boolean;
  createdByName: string | null;
  createdAt: string | null;
  applications: number;
  consultations: number;
}

export async function listLeadSources() {
  const { data } = await api.get<{ items: LeadSourceItem[] }>('/lead-sources');
  return data.items;
}

/** Создать или получить существующий с таким же названием. */
export async function createLeadSource(label: string) {
  const { data } = await api.post<{ item: LeadSourceItem; created: boolean }>('/lead-sources', { label });
  return data;
}

export async function updateLeadSource(code: string, patch: { label?: string; hidden?: boolean }) {
  const { data } = await api.patch<LeadSourceItem>(`/lead-sources/${code}`, patch);
  return data;
}
