/**
 * Суммы приходят с бэкенда строками (Prisma Decimal сериализуется в JSON как
 * строка с двумя знаками после запятой). Эти хелперы только ФОРМАТИРУЮТ для
 * отображения — никакой арифметики над деньгами на фронте: любые суммы и
 * остатки считает сервер (prisma.aggregate/groupBy в payments.service.ts),
 * иначе Double Check и сводка по студенту разъедутся между экранами.
 *
 * Валюта проекта — только сомони (TJS), мультивалютность не нужна.
 */

function toSafeNumber(value: string | number | null | undefined): number {
  const num = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(num) ? num : 0;
}

/** "12345.6" -> "12 345.60" — разделители тысяч + всегда 2 знака после запятой. */
export function formatAmount(value: string | number | null | undefined): string {
  return toSafeNumber(value).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** То же самое, но с суффиксом валюты — для мест без соседней подписи "TJS"/"сомони". */
export function formatMoney(value: string | number | null | undefined): string {
  return `${formatAmount(value)} сомони`;
}
