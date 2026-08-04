import { Region, Role } from '@prisma/client';
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
  /**
   * ТЗ v3 раздел 4. Необязательное намеренно: у студенческих сессий
   * (student-auth) региона нет вовсе, а часть внутренних вызовов передаёт
   * сюда объект, собранный не из JWT. Отсутствие трактуется как BOTH —
   * то есть как поведение до появления регионов, а не как «ничего не видно».
   */
  region?: Region | string | null;
}

/**
 * ТЗ v3 раздел 4 — «Менеджер (Китай): только прикреплённые студенты из Китая»,
 * «Менеджер (Таджикистан): только прикреплённые студенты из Таджикистана».
 *
 * Регион студента в системе не хранится и не нужен: страна выводится из ТОГО,
 * в какое поле вписан менеджер. managerId — ведение в Таджикистане (набор,
 * документы, виза), chinaManagerId — сопровождение уже в Китае. Поэтому
 * «студенты моего региона» и «студенты, назначенные мне по профильному полю» —
 * это одно и то же множество, и отдельная колонка Student.region только
 * плодила бы источник рассинхрона.
 *
 * Возвращает массив условий для OR. Используется и списком (Prisma where), и
 * поштучной проверкой (canAccessStudentRecord) — формула ОДНА, иначе список
 * и карточка однажды разойдутся.
 */
export function assignedFieldsForRegion(region: Region | string | null | undefined): Array<'managerId' | 'chinaManagerId'> {
  if (region === 'TJ') return ['managerId'];
  if (region === 'CN') return ['chinaManagerId'];
  return ['managerId', 'chinaManagerId'];
}

/** Условие Prisma «назначено этому сотруднику в рамках его региона». */
export function assignedToUserFilter(user: AccessUser): Array<Record<string, string>> {
  return assignedFieldsForRegion(user.region).map((field) => ({ [field]: user.id }));
}

/**
 * То же самое ПЛЮС «никому не назначенные».
 *
 * Этой формой пользуются списки грантов, билетов, договоров и платежей: они
 * зеркалят canAccessStudentRecord, где студент без обоих менеджеров доступен
 * любому сотруднику. Списки студентов и заявок пользуются assignedToUserFilter
 * без этой ветки — там «свободные» намеренно не показываются.
 *
 * ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ КОПИЯ УСЛОВИЯ В КАЖДОМ СЕРВИСЕ. До неё формула
 * `OR: [{ managerId: null, chinaManagerId: null }, { managerId: id }, { chinaManagerId: id }]`
 * была продублирована в четырёх файлах, и когда появился регион, обновили
 * только canAccessStudentRecord. Получилось расхождение ровно того сорта, от
 * которого предостерегает комментарий выше: в СПИСКЕ платежей менеджер видел
 * записи по студенту чужого региона, а при открытии карточки получал 404.
 */
export function assignedOrFreeFilter(user: AccessUser): Array<Record<string, unknown>> {
  return [{ managerId: null, chinaManagerId: null }, ...assignedToUserFilter(user)];
}

/**
 * true если пользователь может видеть/редактировать запись:
 *  - FOUNDER и ADMIN — всегда (ТЗ v3: оба видят всех студентов Таджикистана
 *    и Китая; регион на них не влияет);
 *  - EMPLOYEE — только назначенные лично ему по профильному для его региона
 *    полю, либо ещё никому не назначенные («свободные» — их может взять любой).
 *
 * ПОЧЕМУ «СВОБОДНЫЕ» ОСТАЛИСЬ ДОСТУПНЫ ВСЕМ, хотя ТЗ v3 говорит «только
 * прикреплённые»: эта же функция обслуживает ЗАЯВКИ, а свободная заявка —
 * это новый лид, который по разделу 3 ТЗ любой менеджер берёт в работу. Закрыть
 * их означало бы сломать приём лидов. На студентах эффект нулевой: в боевой
 * базе таких записей ровно одна из 201.
 */
export function canAccessStudentRecord(record: AssignableRecord, user: AccessUser): boolean {
  if (isPrivileged(user.role)) return true;
  const assigned = record.managerId || record.chinaManagerId;
  if (!assigned) return true;
  return assignedFieldsForRegion(user.region).some((field) =>
    field === 'managerId'
      ? record.managerId === user.id
      : record.chinaManagerId === user.id,
  );
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
 *
 * TICKET (файл билета, см. tickets/) добавлен волной 8 по той же логике, что
 * RECEIPT: это документ РАЗДЕЛА CRM, а не документ студента. Он не попадает
 * в список документов личного кабинета (см. STUDENT_INCLUDE в
 * student-auth.service.ts), и запрет на скачивание закрывает второй путь —
 * прямую ссылку. Маршрутную квитанцию студенту передаёт менеджер.
 */
export const STUDENT_RESTRICTED_DOC_TYPES = new Set(['BANK', 'MEDICAL', 'RECEIPT', 'TICKET']);
