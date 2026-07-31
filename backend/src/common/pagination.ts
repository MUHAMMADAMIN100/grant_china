/**
 * Разбор query-параметров пагинации.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ХЕЛПЕР. Во всех контроллерах стоял один и тот же паттерн
 * `page ? parseInt(page, 10) : undefined`, а сервисы дальше писали
 * `filters.page ?? 1`. Оператор `??` не ловит NaN, поэтому `?page=abc`
 * доезжал до Prisma как `skip: NaN` и превращался в 500 вместо честного 400.
 * То же с отрицательными и дробными значениями.
 *
 * Возвращаем undefined для мусора — вызывающий код сам подставит дефолт,
 * то есть плохой параметр деградирует до «первой страницы», а не роняет
 * запрос. Это безопаснее, чем бросать исключение: пагинация — вспомогательный
 * параметр, из-за опечатки в URL список показывать не перестаёт.
 */

/** Верхняя граница размера страницы — защита от `?pageSize=100000`. */
const MAX_PAGE_SIZE = 100;

export function parsePage(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

export function parsePageSize(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(n, MAX_PAGE_SIZE);
}
