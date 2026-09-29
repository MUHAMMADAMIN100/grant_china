/**
 * 29.09.2026 — архив студентов (раздел «Архив» в меню CRM).
 *
 * Студент в архиве — это status = ARCHIVED плюс кто, когда и с каким
 * комментарием его туда отправил (Student.archivedAt / archivedById /
 * archiveComment) и каким был статус до этого (statusBeforeArchive — туда
 * он и вернётся по «Вернуть из архива»).
 *
 * Заявки студента уходят в архив вместе с ним и помечаются этой причиной в
 * Application.archiveReason. По ней «Вернуть» отличает заявки, которые ушли
 * ВМЕСТЕ со студентом, от тех, что лежали в архиве и раньше (ручной архив
 * «MANUAL…» или авто-архив джобы): возвращаются только первые.
 */
export const STUDENT_ARCHIVE_REASON = 'STUDENT';

export const isStudentArchiveReason = (reason: string | null | undefined): boolean =>
  reason === STUDENT_ARCHIVE_REASON;

/**
 * Потолок одной пачки. Архивация идёт по студенту в отдельной транзакции
 * (студент + его заявки), поэтому 200 — это десяток секунд на Railway, а не
 * минуты. Больше за раз в интерфейсе и не выбрать: галочки ставятся по
 * странице в 10 строк.
 */
export const STUDENT_ARCHIVE_MAX_BATCH = 200;
