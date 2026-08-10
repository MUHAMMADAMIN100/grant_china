/**
 * Скалярные поля студента, безопасные для отдачи в CRM. Через `select`
 * (а не `include`) сознательно НЕ включаем `password` — это bcrypt-хэш
 * пароля личного кабинета студента. `include` в Prisma подтягивает ВСЕ
 * скалярные поля модели по умолчанию, поэтому раньше password утекал
 * в каждом ответе GET /students, GET /students/:id и вложенным студентом
 * в GET /applications, GET /applications/:id.
 *
 * Раньше этот список был продублирован дословно в students.service.ts и
 * applications.service.ts (Проблема G аудита волны 1) — добавят новое
 * чувствительное поле в схему, обновят один файл, забудут второй, утечка
 * вернётся. Теперь единственный источник истины — здесь.
 */
export const STUDENT_SAFE_FIELDS = {
  id: true,
  fullName: true,
  phones: true,
  email: true,
  applicationForm: true,
  photoUrl: true,
  direction: true,
  cabinet: true,
  status: true,
  comment: true,
  managerId: true,
  chinaManagerId: true,
  programId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  // ТЗ «Разделение воронок» — факт передачи в китайский офис. В общем наборе,
  // а не точечно: по нему решается доступ (hasAccess), а значит поле обязано
  // приходить в КАЖДОЙ выборке студента, иначе проверка получит undefined и
  // молча пропустит.
  transferredToChinaAt: true,
} as const;
