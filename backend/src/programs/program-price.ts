import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Цены программы (04.11.2026): за год (`cost`) и за 1 семестр (`semesterCost`),
 * валюта у обеих общая. Обязательна хотя бы одна; null — «цена не указана».
 * Программа «1 semester» хранит только цену за семестр.
 */

export const MAX_PROGRAM_PRICE = 10_000_000;
export const PRICES_REQUIRED_MESSAGE = 'Укажите стоимость за год или за семестр';

export const COST_LABEL = 'Стоимость за год';
export const SEMESTER_COST_LABEL = 'Стоимость за семестр';

/** По какой цене ищет фильтр «Цена от — до»: за год (по умолчанию) или за семестр. */
export type CostPeriod = 'year' | 'semester';

export function costField(period: unknown): 'cost' | 'semesterCost' {
  return period === 'semester' ? 'semesterCost' : 'cost';
}

/**
 * Цена из формы создания (JSON или multipart, где всё приходит строками).
 * Пусто ('' / null / undefined) — null. Не число, ноль, минус или больше
 * предела — 400 с понятным текстом: без этого в базу попал бы NaN или 0.
 */
export function parsePriceInput(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new BadRequestException(`${label} должна быть числом`);
  if (n <= 0) throw new BadRequestException(`${label} должна быть больше 0`);
  if (n > MAX_PROGRAM_PRICE) {
    throw new BadRequestException(`${label} — не больше ${MAX_PROGRAM_PRICE.toLocaleString('ru-RU')}`);
  }
  return n;
}

/** Хотя бы одна цена должна остаться — и при создании, и после правки. */
export function assertPrices(cost: number | null | undefined, semesterCost: number | null | undefined) {
  if (cost == null && semesterCost == null) throw new BadRequestException(PRICES_REQUIRED_MESSAGE);
}

/** Число из query-строки; мусор и пустая строка — «не задано» (раньше NaN ронял запрос в 500). */
function queryNumber(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Условие фильтра «Цена от — до». Сравнивается цена за год или за семестр
 * (costPeriod). Программы без выбранной цены (null) в выборку не попадают:
 * SQL-сравнение с NULL ложно, отдельное условие не нужно.
 */
export function priceRangeWhere(
  minCost: string | number | undefined,
  maxCost: string | number | undefined,
  period: unknown,
): Prisma.ProgramWhereInput {
  const min = queryNumber(minCost);
  const max = queryNumber(maxCost);
  if (min === undefined && max === undefined) return {};
  const range: Prisma.FloatNullableFilter = {};
  if (min !== undefined) range.gte = min;
  if (max !== undefined) range.lte = max;
  return { [costField(period)]: range };
}

/** «16 200 CNY» — тот же формат, что был в посте канала (toLocaleString ru-RU). */
export function formatPrice(amount: number, currency: string): string {
  return `${amount.toLocaleString('ru-RU')} ${currency}`;
}
