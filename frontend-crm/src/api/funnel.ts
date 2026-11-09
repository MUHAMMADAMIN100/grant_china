import { api } from './client';
import type { ApplicationStatus, Direction } from './types';

/**
 * 09.11.2026 — «Воронка»: доска заявок по этапам. Контракт зеркалит
 * ApplicationsService.board() (backend/src/applications/applications.service.ts).
 */
export const FUNNEL_COLUMNS = ['NEW', 'DOCS_REVIEW', 'DOCS_SUBMITTED', 'PRE_ADMISSION', 'AWAITING_PAYMENT', 'ENROLLED', 'ARCHIVED'] as const;
export type FunnelColumnKey = (typeof FUNNEL_COLUMNS)[number];

export interface FunnelCard {
  id: string;
  fullName: string;
  phone: string;
  direction: Direction;
  status: ApplicationStatus;
  source: string | null;
  sourceDetail: string | null;
  createdAt: string;
  archivedAt: string | null;
  archiveReason: string | null;
  studentId: string | null;
  repeatOfId: string | null;
  manager: { id: string; fullName: string } | null;
  chinaManager: { id: string; fullName: string } | null;
  /** Открытые задачи по заявке и из них просроченные. */
  openTasks: number;
  overdueTasks: number;
  /** Привязанный чат (самый свежий) — иконка «написать». */
  chat: { id: string; channel: string } | null;
}

export interface FunnelColumn {
  key: FunnelColumnKey;
  label: string;
  /** Всего заявок в колонке; карточек приходит не больше 300. */
  count: number;
  items: FunnelCard[];
}

export interface FunnelFilters {
  search?: string;
  direction?: string;
  manager?: string;
  source?: string;
  mine?: boolean;
  /** Границы периода по дате создания заявки, ISO. */
  from?: string;
  to?: string;
}

export async function getFunnelBoard(filters: FunnelFilters = {}) {
  const { data } = await api.get<{ columns: FunnelColumn[] }>('/applications/board', {
    params: {
      search: filters.search || undefined,
      direction: filters.direction || undefined,
      manager: filters.manager || undefined,
      source: filters.source || undefined,
      mine: filters.mine ? 'true' : undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    },
  });
  return data;
}

export async function getFunnelLabels() {
  const { data } = await api.get<Record<FunnelColumnKey, string>>('/applications/funnel-labels');
  return data;
}

/** Пустая подпись — вернуть стандартную. Только руководство. */
export async function saveFunnelLabels(labels: Partial<Record<FunnelColumnKey, string>>) {
  const { data } = await api.put<Record<FunnelColumnKey, string>>('/applications/funnel-labels', labels);
  return data;
}
