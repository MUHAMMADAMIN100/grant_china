// Общие хелперы для полей <input type="datetime-local"> (ТЗ 3.2 — дата и
// время повторного звонка/срока задачи). JS трактует значение datetime-local
// как ЛОКАЛЬНОЕ время браузера: `new Date(value).toISOString()` при отправке
// на бэкенд уже даёт корректный UTC — конвертация нужна только при ЧТЕНИИ
// готового ISO обратно в значение для инпута (см. scheduler/time.ts на
// бэкенде — тот же принцип «конвертируем как можно меньше мест»).

/**
 * ISO-строка (UTC) -> значение для <input type="datetime-local"> в ЛОКАЛЬНОМ
 * времени браузера. Обратная операция к new Date(value).toISOString().
 */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * Границы периода из двух <input type="date"> в ISO для бэкенда.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ХЕЛПЕР. Голое `new Date('2026-07-01')` по спецификации
 * ECMAScript парсится как UTC-полночь, а `new Date('2026-07-01T23:59:59')`
 * (форма со временем без зоны) — как ЛОКАЛЬНОЕ время. То есть нижняя и
 * верхняя границы одного и того же фильтра считались по РАЗНЫМ часовым
 * поясам: в Душанбе (UTC+5) нижняя уезжала на 05:00, и записи с 00:00 до
 * 05:00 первого дня периода молча выпадали из выборки.
 *
 * Здесь обе границы явно строятся как локальное время, симметрично.
 * Один хелпер на все страницы — фильтр по датам используется в пяти местах
 * (заявки, консультации, активность, платежи, аналитика), и три копии одной
 * формулы неизбежно разъезжаются.
 */
export function toPeriodRange(
  from: string | undefined,
  to: string | undefined,
): { from?: string; to?: string } {
  return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
}

/** Человекочитаемые дата+время (ru-RU) — для бейджей и подсказок. */
export function formatDateTimeRu(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
