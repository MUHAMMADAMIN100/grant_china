import { api } from './client';

/** 07.09.2026 — диск загрузок на сервере: здоровье, сироты, уборка. См. backend/src/files/storage.service.ts. */
export interface StorageHealth {
  path: string;
  totalBytes: number | null;
  freeBytes: number | null;
  usedBytes: number | null;
  freePercent: number | null;
  writable: boolean;
  writeError: string | null;
  filesCount: number;
  filesBytes: number;
  checkedAt: string;
}

export interface OrphanFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface OrphanScan {
  root: string;
  scannedAt: string;
  filesCount: number;
  filesBytes: number;
  referencedCount: number;
  referencedBytes: number;
  orphans: OrphanFile[];
  orphansBytes: number;
  recentUnreferenced: number;
}

export async function getStorageHealth() {
  const { data } = await api.get<StorageHealth>('/storage/health');
  return data;
}

export async function scanOrphans() {
  const { data } = await api.get<OrphanScan>('/storage/orphans');
  return data;
}

export async function purgeOrphans(names: string[]) {
  const { data } = await api.post<{ deleted: string[]; freedBytes: number; skipped: string[] }>('/storage/orphans/purge', { names });
  return data;
}

export function formatBytes(b: number | null | undefined): string {
  if (b === null || b === undefined) return '—';
  if (b < 1024) return `${b} Б`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} КБ`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} МБ`;
  return `${(mb / 1024).toFixed(2)} ГБ`;
}
