import { IsOptional, Matches } from 'class-validator';

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ТЗ 4 — «Перевести на следующий год». startsAt — ФАКТИЧЕСКАЯ дата старта
 * нового года, если она отличается от плановой (nextYearStartsAt). Явное
 * действие человека — грант не продвигается по календарю сам (см.
 * grants.service.ts advance()).
 */
export class AdvanceGrantDto {
  @IsOptional()
  @Matches(CALENDAR_DATE_RE, { message: 'startsAt должен быть в формате YYYY-MM-DD' })
  startsAt?: string;
}
