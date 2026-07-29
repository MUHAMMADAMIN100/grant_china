import { Role } from '@prisma/client';
import { isPrivileged } from './roles';

/**
 * Единая формула доступа к записям, привязанным к менеджерам (студент,
 * заявка, документ/фото студента через files/uploads-access.service.ts).
 *
 * Раньше эта формула была продублирована дословно в students.service.ts и
 * applications.service.ts (Проблема G аудита волны 1) — при добавлении
 * нового потребителя (uploads) копий стало бы уже 3-4, и расхождение между
 * ними — вопрос времени. Теперь both сервиса и files/* импортируют отсюда.
 */
export interface AssignableRecord {
  managerId: string | null;
  chinaManagerId?: string | null;
}

export interface AccessUser {
  id: string;
  role: Role | string;
}

/**
 * true если пользователь может видеть/редактировать запись:
 *  - FOUNDER и ADMIN — всегда;
 *  - EMPLOYEE — только назначенные лично ему (managerId/chinaManagerId),
 *    либо ещё никому не назначенные («свободные» — их может взять любой).
 */
export function canAccessStudentRecord(record: AssignableRecord, user: AccessUser): boolean {
  if (isPrivileged(user.role)) return true;
  const assigned = record.managerId || record.chinaManagerId;
  if (!assigned) return true;
  return record.managerId === user.id || record.chinaManagerId === user.id;
}

/**
 * Типы документов, которые СТУДЕНТ загружает, но НЕ должен скачивать
 * обратно (мед.справка и справка из банка — персональные/финансовые
 * данные, доступны только сотрудникам CRM). Раньше дублировалось дословно
 * в student-auth.service.ts и student-auth.controller.ts.
 *
 * RECEIPT (чек к платежу, см. payments/) добавлен по той же логике: это
 * финансовый документ, который загружает сотрудник (не студент), и он не
 * должен быть доступен студенту через /uploads даже при прямой ссылке —
 * защита в глубину поверх фильтрации в students.service.ts/student-auth.service.ts.
 */
export const STUDENT_RESTRICTED_DOC_TYPES = new Set(['BANK', 'MEDICAL', 'RECEIPT']);
