import { api } from './client';
import type { PaymentsAnalytics } from './types';

export interface AnalyticsFilters {
  /** ISO-строки — границы периода (включительно). Оба необязательны на бэкенде,
   *  но страница Analytics.tsx всегда передаёт оба — иначе не с чем сравнивать выбор периода. */
  from?: string;
  to?: string;
}

/** GET /payments/analytics/summary — backend/src/payments/finance-analytics.controller.ts, только FOUNDER/ADMIN. */
export async function getPaymentsAnalytics(filters: AnalyticsFilters = {}) {
  const { data } = await api.get<PaymentsAnalytics>('/payments/analytics/summary', { params: filters });
  return data;
}
