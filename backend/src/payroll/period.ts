import { BadRequestException } from '@nestjs/common';
import { APP_TZ_OFFSET_MINUTES, toLocal } from '../scheduler/time';

/**
 * Раздел 5 ТЗ (волна 6) — расчётный период Payslip = КАЛЕНДАРНЫЙ МЕСЯЦ ПО
 * ДУШАНБЕ (UTC+5, см. scheduler/time.ts), полуинтервал [from, to). Границы
 * вычисляются ОДИН РАЗ и сохраняются в Payslip.periodStart/periodEnd —
 * пересчёт листа не должен зависеть от того, поменяли ли когда-нибудь
 * APP_TZ_OFFSET_MINUTES (см. schema.prisma, комментарий к Payslip).
 */

const PERIOD_KEY_RE = /^(\d{4})-(\d{2})$/;

export interface PeriodRange {
  /** 'YYYY-MM' — нормализованный ключ периода. */
  key: string;
  /** Начало периода (включительно), UTC. */
  from: Date;
  /** Конец периода (исключая), UTC. */
  to: Date;
}

/** Разбирает 'YYYY-MM' в границы календарного месяца по Душанбе, в UTC. Бросает 400 при мусоре. */
export function periodRangeFromKey(raw: string): PeriodRange {
  const m = PERIOD_KEY_RE.exec((raw ?? '').trim());
  if (!m) throw new BadRequestException('Период должен быть в формате YYYY-MM');
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new BadRequestException('Период должен быть в формате YYYY-MM');

  const localStartMs = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const localEndMs = month === 12 ? Date.UTC(year + 1, 0, 1, 0, 0, 0) : Date.UTC(year, month, 1, 0, 0, 0);
  const from = new Date(localStartMs - APP_TZ_OFFSET_MINUTES * 60_000);
  const to = new Date(localEndMs - APP_TZ_OFFSET_MINUTES * 60_000);
  return { key: `${m[1]}-${m[2]}`, from, to };
}

/** 'YYYY-MM' по Душанбе для месяца, содержащего UTC-момент `at` — текущий период. */
export function periodKeyFor(at: Date): string {
  const local = toLocal(at);
  const y = local.getUTCFullYear();
  const mo = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mo}`;
}

/** Период, предшествующий тому, что содержит `at` — джоба закрытия периода генерирует листы ЗА него. */
export function previousPeriodKey(at: Date): string {
  const local = toLocal(at);
  const prevMonthAnchor = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1));
  const y = prevMonthAnchor.getUTCFullYear();
  const mo = String(prevMonthAnchor.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mo}`;
}
