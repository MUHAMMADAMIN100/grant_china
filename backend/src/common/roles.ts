import { Role } from '@prisma/client';

/**
 * Иерархия ролей в CRM GrantChina:
 *  - FOUNDER  — верхний уровень («Основатель»). Видит и может редактировать
 *               всё в системе, включая единоличное управление сотрудниками
 *               (users.controller.ts — там роль FOUNDER проверяется отдельно,
 *               см. isFounder ниже).
 *  - ADMIN    — операционный уровень («Администратор»). Те же права на
 *               студентов/заявки/задачи/программы, что и у FOUNDER, но не
 *               может создавать/удалять сотрудников и менять им роли.
 *  - EMPLOYEE — «Менеджер» в интерфейсе. Видит и редактирует только то, что
 *               назначено лично ему (managerId/chinaManagerId/assignedToId),
 *               либо ещё никому не назначенные («свободные») записи.
 *
 * ВАЖНО: раньше по всему бэкенду проверка привилегий была захардкожена как
 * `user.role !== 'ADMIN'`. Поскольку FOUNDER по иерархии стоит ВЫШЕ ADMIN,
 * такая проверка ошибочно резала доступ Основателю. Все подобные проверки
 * должны использовать isPrivileged() ниже, а не сравнение с 'ADMIN' напрямую.
 */

/** true для FOUNDER и ADMIN — «привилегированные» роли, видят/редактируют всё. */
export function isPrivileged(role: Role | string | null | undefined): boolean {
  return role === 'FOUNDER' || role === 'ADMIN';
}

/**
 * true только для FOUNDER — используется там, где ADMIN намеренно
 * ограничен (например, управление сотрудниками в users.controller.ts,
 * где ADMIN имеет только read-only доступ).
 */
export function isFounder(role: Role | string | null | undefined): boolean {
  return role === 'FOUNDER';
}
