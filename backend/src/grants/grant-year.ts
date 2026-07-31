import { GrantIntake } from '@prisma/client';
import { APP_TZ_OFFSET_MINUTES, toLocal } from '../scheduler/time';

/**
 * Раздел 4 ТЗ — вспомогательные функции реестра грантов. Вынесены отдельно
 * от grants.service.ts, потому что их же (в частности addYears) переиспользует
 * джоба планировщика (scheduler/jobs/academic-year-reminder.job.ts), а джоба
 * НЕ должна ходить через GrantsService (см. apiSurface проекта архитектора —
 * джоба работает с prisma.studentGrant напрямую, минуя HTTP-слой сервиса).
 */

/**
 * Превращает календарную дату 'YYYY-MM-DD' (как её вводит менеджер в
 * <input type="date">) в UTC-момент, соответствующий 00:00 ПО ДУШАНБЕ этой
 * даты. Без этого 'new Date("2027-09-01")' даёт полночь UTC, и «1 сентября»
 * показалось бы всей базе как 31 августа (см. риск 5 проекта архитектора).
 */
export function parseCalendarDate(raw: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error(`Некорректная дата: "${raw}", ожидается YYYY-MM-DD`);
  const [, y, mo, d] = m;
  const utcMidnight = Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
  const local = new Date(utcMidnight - APP_TZ_OFFSET_MINUTES * 60_000);
  if (Number.isNaN(local.getTime())) throw new Error(`Некорректная дата: "${raw}"`);
  return local;
}

/**
 * Прибавляет N лет к дате, сохраняя календарный день по Душанбе. Клапан для
 * 29 февраля: `setUTCFullYear` на несуществующую дату в невисокосном году
 * молча откатывается на 1 марта — растягивая дату гранта на день вперёд.
 * Клампим на 28 февраля вместо этого (риск 5 проекта архитектора).
 */
export function addYears(date: Date, years: number): Date {
  const local = toLocal(date);
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const isFeb29 = month === 1 && day === 29;
  const shifted = new Date(local.getTime());
  shifted.setUTCFullYear(local.getUTCFullYear() + years, month, isFeb29 ? 28 : day);
  return new Date(shifted.getTime() - APP_TZ_OFFSET_MINUTES * 60_000);
}

/**
 * Набор, с которого стартует учебный год — производится из МЕСЯЦА startDate
 * по Душанбе. Границы: август-сентябрь → сентябрьский набор (основной в
 * Китае), январь-март → февральский набор, остальное — «прочее».
 */
export function detectIntake(startDate: Date): GrantIntake {
  const month = toLocal(startDate).getUTCMonth() + 1; // 1..12 по Душанбе
  if (month === 8 || month === 9) return GrantIntake.SEPTEMBER;
  if (month >= 1 && month <= 3) return GrantIntake.FEBRUARY;
  return GrantIntake.OTHER;
}

/** 'DD.MM.YYYY' по Душанбе — единый формат для details в ActivityLog. */
export function formatDateRuShort(date: Date): string {
  const local = toLocal(date);
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = local.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// ТЗ 4 — «Позвонить студенту и проинформировать о начале ВТОРОГО/ТРЕТЬЕГО...
// года обучения». Числительное для n = currentYear + 1 (год, который скоро
// начнётся). Пустая строка вместо числительного превратила бы фразу в
// «о начале  года обучения» — поэтому есть явный фолбэк для n > 7.
const ORDINAL_RU: Record<number, string> = {
  2: 'второго',
  3: 'третьего',
  4: 'четвёртого',
  5: 'пятого',
  6: 'шестого',
  7: 'седьмого',
};

export function ordinalYearRu(n: number): string {
  return ORDINAL_RU[n] ?? `${n}-го`;
}
