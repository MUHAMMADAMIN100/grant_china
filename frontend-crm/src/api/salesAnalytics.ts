import { api } from './client';

/**
 * 09.11.2026 — Аналитика → «Продажи». Контракт зеркалит
 * SalesAnalyticsService.summary() (backend/src/analytics/sales-analytics.service.ts).
 * Деньги — строки с двумя знаками (как во всей CRM), null — сумма скрыта
 * (поимённые деньги Администратору не показываются).
 */
export type SalesPeriodKey = 'today' | 'week' | 'month' | 'year';

export interface SalesKpiValue<T> {
  value: T;
  prev: T;
}

export interface SalesAnalytics {
  period: { key: SalesPeriodKey; from: string; to: string; prevFrom: string; prevTo: string };
  scope:
    | { kind: 'all'; money: boolean }
    | { kind: 'employee' | 'self'; id: string; name: string; money: boolean };
  kpi: {
    leads: SalesKpiValue<number>;
    deals: SalesKpiValue<number>;
    conversion: SalesKpiValue<number | null> & { converted: number; leads: number };
    revenue: SalesKpiValue<string> | null;
  };
  monthly: Array<{ month: string; leads: number; converted: number; conversion: number | null }>;
  sources: Array<{ code: string; label: string; count: number }>;
  managers: { money: boolean; items: Array<{ id: string; name: string; deals: number; revenue: string | null }> };
  response: { asks: number; answered: number; within15: number; avgMinutes: number | null; medianMinutes: number | null };
  channels: Array<{ channel: string; label: string; asks: number; answered: number; medianMinutes: number | null }>;
  stages: Array<{ key: string; label: string; count: number }>;
  progress: { total: number; refused: number; stages: Array<{ key: string; label: string; reached: number; pct: number }> };
  revenue: {
    revenue: { amount: string; count: number };
    received: { amount: string; count: number };
    expected: { amount: string; pending: { amount: string; count: number }; planned: string };
  } | null;
}

export async function getSalesAnalytics(period: SalesPeriodKey, employee?: string) {
  const { data } = await api.get<SalesAnalytics>('/analytics/sales', { params: { period, employee: employee || undefined } });
  return data;
}
