import type { Program } from '../api/programs';

/**
 * Цены программы (04.11.2026): за год и за 1 семестр, валюта общая.
 * Обязательна хотя бы одна; null — «не указана». Совпадает с проверкой
 * бэкенда (backend/src/programs/program-price.ts).
 */
export const MAX_PROGRAM_PRICE = 10_000_000;
export const PRICES_REQUIRED_MESSAGE = 'Укажите стоимость за год или за семестр';

export interface PriceLine {
  key: 'year' | 'semester';
  /** «16 200 CNY» */
  amount: string;
  /** «/ год», «/ семестр» */
  unit: string;
}

/** Указанные цены программы по строкам, сначала год. */
export function programPriceLines(p: Pick<Program, 'cost' | 'semesterCost' | 'currency'>): PriceLine[] {
  const lines: PriceLine[] = [];
  if (p.cost != null) lines.push({ key: 'year', amount: `${p.cost.toLocaleString('ru-RU')} ${p.currency}`, unit: '/ год' });
  if (p.semesterCost != null) {
    lines.push({ key: 'semester', amount: `${p.semesterCost.toLocaleString('ru-RU')} ${p.currency}`, unit: '/ семестр' });
  }
  return lines;
}

/** Значение поля цены → число или null («не указана»): пустая строка и мусор — null. */
export function toPriceValue(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
