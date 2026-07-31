/**
 * Раздел 3.1 ТЗ — правила авто-архива заявок (jobs/application-auto-archive.job.ts).
 * Пороги вынесены в env, чтобы Основатель мог подкрутить их без правки кода.
 */

/** ENROLLED + N дней без изменений → авто-архив («зачислен, работа с деньгами продолжается ещё месяцами»). */
export const ENROLLED_ARCHIVE_DAYS = parsePositiveInt(process.env.ENROLLED_ARCHIVE_DAYS, 30);

/** NEW + N дней без изменений → авто-архив (протухший лид, до которого никто не дошёл). */
export const STALE_NEW_ARCHIVE_DAYS = parsePositiveInt(process.env.STALE_NEW_ARCHIVE_DAYS, 90);

export type AutoArchiveMode = 'dry' | 'on';

/**
 * Kill-switch первого боевого прогона (тот же приём, что UPLOADS_PROTECTED
 * в app.module.ts). Среди 229 заявок много старых — правило «NEW 90 дней»
 * уведёт в архив заметную долю базы одним махом. По умолчанию 'dry': джоба
 * ничего не пишет, только считает кандидатов и раз в сутки уведомляет
 * FOUNDER. Явное AUTO_ARCHIVE_MODE=on в Railway env включает реальную запись.
 */
export const AUTO_ARCHIVE_MODE: AutoArchiveMode = process.env.AUTO_ARCHIVE_MODE === 'on' ? 'on' : 'dry';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
