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

/** Душанбе, UTC+5 — та же константа, что APP_TZ_OFFSET_MINUTES в backend/src/scheduler/time.ts. */
const APP_TZ_OFFSET_MINUTES = 300;

/**
 * ISO-момент КАЛЕНДАРНОЙ даты -> значение <input type="date">.
 *
 * ПРАВИЛО. Поля, которые бэкенд разбирает через parseCalendarDate
 * (grants/grant-year.ts) — startDate и nextYearStartsAt гранта, effectiveFrom
 * набора формул и договора компенсации, signedAt договора — хранятся как
 * полночь ПО ДУШАНБЕ, то есть как 19:00 ПРЕДЫДУЩИХ суток в UTC.
 *
 * Поэтому `iso.slice(0, 10)` брать НЕЛЬЗЯ: срез отдаёт UTC-часть, то есть день
 * назад. Список показывает «01.09.2026» (toLocaleDateString считает по зоне
 * браузера), а форма редактирования той же записи — «31.08.2026»; сохранение
 * без правки даты отправляет сдвинутый день обратно, и КАЖДОЕ сохранение
 * теряет ровно сутки — сдвиг накопительный, за ним уезжают вычисляемые от
 * даты значения (следующий учебный год, окно джобы напоминаний, период
 * действия формул).
 *
 * Возвращаем момент в Душанбе и только потом берём UTC-компоненты —
 * симметрично parseCalendarDate, которая этот же сдвиг вычитает.
 */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + APP_TZ_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * Сегодняшняя дата в формате <input type="date"> — по МЕСТНОМУ времени, а не
 * по UTC.
 *
 * `new Date().toISOString().slice(0, 10)` здесь неверен: в Душанбе (UTC+5)
 * с полуночи до 05:00 он отдаёт ВЧЕРАШНИЙ день. Практическое следствие
 * зависит от места использования: в `max` он гасит сегодняшний день в
 * календаре (интерфейс запрещает то, что бэкенд принимает), в значении по
 * умолчанию — тихо подставляет вчера, и платёж или консультация уезжают в
 * предыдущий расчётный период, раздувая базу бонуса за уже закрываемый месяц.
 *
 * Одна функция на все формы: три копии этой строки уже успели разъехаться.
 */
export function todayInputValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/**
 * Раздел 5 ТЗ (волна 6) — 'YYYY-MM' для <input type="month"> и параметра
 * period в /payroll/*. Локальное время браузера — достаточно для дефолта
 * фильтра, точные границы периода считает бэкенд (payroll/period.ts, UTC+5).
 */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
