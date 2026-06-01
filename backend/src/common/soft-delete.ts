/**
 * Утилиты для soft-delete.
 *
 * Идея: вместо `prisma.X.delete()` сервисы вызывают
 * `prisma.X.update({ data: { deletedAt: new Date() } })`. Все запросы
 * на чтение добавляют фильтр `deletedAt: null`. Атакующий через API
 * не может физически стереть данные — они остаются в БД и могут быть
 * восстановлены FOUNDER'ом (deletedAt = null).
 */

/** Стандартный фильтр для finder'ов: брать только НЕ-удалённые записи. */
export const notDeleted = { deletedAt: null } as const;

/**
 * Подменяет email (или другое уникальное поле) при soft-delete,
 * чтобы освободить значение для будущего использования. Иначе
 * @unique constraint не даст создать нового юзера с тем же email,
 * пока старый «удалённый» висит в БД с этим email.
 *
 * Формат: `originalEmail.deleted.<timestamp>` — оригинал восстановим
 * по последнему '.deleted.' через скрипт миграции / админ-инструмент.
 */
export function tombstoneEmail(email: string): string {
  return `${email}.deleted.${Date.now()}`;
}
