/**
 * Раздел 3.1 ТЗ — «источник привлечения». Единственный источник истины по
 * значениям справочника: Application.source/Consultation.source в БД — это
 * String, а НЕ enum (см. комментарий у поля в schema.prisma) — добавить
 * новый канал (волна 7, Chat Place) значит дописать одну строку сюда, а не
 * гонять ALTER TYPE на живой колонке.
 *
 * TIKTOK — доминирующий канал для абитуриентов 16–18 лет в Таджикистане, без
 * него менеджеры писали бы его в «Другое» и обнулили ценность отчёта.
 * Отдельного значения «неизвестно» нет: оно уже выражается через null у
 * source, два способа сказать «ничего» дают расхождения в отчётах.
 */
export interface LeadSourceOption {
  value: string;
  label: string;
}

export const LEAD_SOURCES: readonly LeadSourceOption[] = [
  { value: 'WEBSITE', label: 'Сайт' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'REFERRAL', label: 'Рекомендация (сарафан)' },
  { value: 'OFFICE_VISIT', label: 'Визит в офис' },
  { value: 'ADS', label: 'Реклама' },
  { value: 'OTHER', label: 'Другое' },
] as const;

export const LEAD_SOURCE_VALUES: readonly string[] = LEAD_SOURCES.map((s) => s.value);

export type LeadSource = (typeof LEAD_SOURCES)[number]['value'];

export const LEAD_SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.label]),
);

/**
 * Нормализует значение источника перед записью в БД: обрезает пробелы,
 * приводит к верхнему регистру. Неизвестное непустое значение сознательно
 * НЕ отбрасывается в null, а сводится к OTHER — источник был указан, просто
 * его название незнакомо справочнику (защита в глубину: DTO уже проверяет
 * @IsIn(LEAD_SOURCE_VALUES) на границе API, сюда долетают только валидные
 * значения на штатных путях, но сервис не должен доверять этому слепо).
 */
export function normalizeSource(raw: string | null | undefined): LeadSource | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  return LEAD_SOURCE_VALUES.includes(upper) ? upper : 'OTHER';
}
