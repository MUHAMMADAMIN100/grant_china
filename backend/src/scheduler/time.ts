/**
 * Часовой пояс Таджикистана — фиксированный UTC+5, БЕЗ перехода на летнее
 * время (в TJ его нет с 1991 года). Поэтому простой числовой сдвиг здесь
 * МАТЕМАТИЧЕСКИ ТОЧЕН — в отличие от Европы, где такой подход был бы неверен.
 * Если TJ когда-нибудь введёт DST — заменить на
 * `new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Dushanbe', hour: 'numeric', hour12: false })`
 * (Node 20 с полным ICU это умеет), но переписывать все места вызова не
 * придётся — сигнатуры функций ниже останутся теми же.
 *
 * Все DateTime в БД хранятся в UTC (как во всей схеме проекта). Эти хелперы
 * нужны ТОЛЬКО планировщику — для «тихих часов» и границ календарного дня
 * по Душанбе; ввод дат из форм (dueDate/heldAt/followUpAt) TZ-математики не
 * требует вовсе (datetime-local уже в местном времени браузера сотрудника).
 */
export const APP_TZ_OFFSET_MINUTES = 300; // UTC+5

/** UTC-момент, сдвинутый на локальный часовой пояс — используем только UTC-геттеры результата. */
export function toLocal(utc: Date): Date {
  return new Date(utc.getTime() + APP_TZ_OFFSET_MINUTES * 60_000);
}

/** Час суток по Душанбе (0–23) для UTC-момента. */
export function localHour(utc: Date): number {
  return toLocal(utc).getUTCHours();
}

/** Начало календарных суток по Душанбе, возвращённое обратно в UTC. */
export function localDayStart(utc: Date): Date {
  const local = toLocal(utc);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - APP_TZ_OFFSET_MINUTES * 60_000);
}
