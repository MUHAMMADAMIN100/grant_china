import { api } from './client';

export type ActivityAction =
  | 'STATUS_CHANGE'
  | 'STUDENT_UPDATE'
  | 'STUDENT_CREATE'
  | 'STUDENT_DELETE'
  | 'MANAGER_CHANGE'
  | 'PROGRAM_CHANGE'
  // Финансы (ТЗ 1.1) — значения строго совпадают с TS-union в
  // backend/src/activity/activity.service.ts (поле action в БД — String,
  // миграция не нужна).
  | 'PAYMENT_CREATE'
  | 'PAYMENT_UPDATE'
  | 'PAYMENT_SUBMIT'
  | 'PAYMENT_RECALL'
  | 'PAYMENT_APPROVE'
  | 'PAYMENT_REJECT'
  | 'PAYMENT_VOID'
  | 'PAYMENT_DELETE'
  | 'PAYMENT_SCHEDULE_UPDATE'
  // Кадровые события (ТЗ 2.12 — управление правами) — пишутся из
  // backend/src/users/users.service.ts, видны только в журнале FOUNDER/ADMIN.
  | 'USER_CREATE'
  | 'USER_ROLE_CHANGE'
  | 'USER_DELETE'
  // ТЗ раздел 3 (волна 3) — заявки: архив/источник/повторные обращения.
  // Пишутся из applications.service.ts.
  | 'APPLICATION_ARCHIVE'
  | 'APPLICATION_UNARCHIVE'
  | 'APPLICATION_SOURCE_CHANGE'
  | 'APPLICATION_CLEAR_REPEAT'
  // ТЗ 3.2 — консультации/собеседования. Пишутся из consultations.service.ts.
  | 'CONSULTATION_CREATE'
  | 'CONSULTATION_UPDATE'
  | 'CONSULTATION_DELETE'
  | 'CONSULTATION_CONVERT'
  // Системная (авто-созданная) задача — TasksService.createSystemTask().
  // Используется и консультациями (ТЗ 3.2), и напоминаниями о начале
  // учебного года по гранту (раздел 4, волна 4).
  | 'TASK_AUTO_CREATE'
  // Раздел 6.3 ТЗ (волна 4) — ручное создание задачи (в отличие от
  // TASK_AUTO_CREATE выше). Пишется из tasks.service.ts create().
  | 'TASK_CREATE'
  // Раздел 6.3 ТЗ — «прикрепление чеков» как ОТДЕЛЬНОЕ событие ленты (раньше
  // размазано по PAYMENT_UPDATE — было невозможно отфильтровать в UI).
  | 'PAYMENT_RECEIPT_ADD'
  | 'PAYMENT_RECEIPT_REMOVE'
  // Раздел 6.3 ТЗ — загрузка/удаление обычного документа студента (паспорт,
  // диплом и т.п., не чек).
  | 'DOCUMENT_UPLOAD'
  | 'DOCUMENT_DELETE'
  // Раздел 6.3 ТЗ — текстовые комментарии как события ленты (новая модель
  // Comment, отдельная от Student.comment/Application.comment).
  | 'COMMENT_CREATE'
  | 'COMMENT_UPDATE'
  | 'COMMENT_DELETE'
  // Раздел 6.3 ТЗ — заготовка под IP-телефонию (волна 7). Тип события заведён
  // сейчас, записей звонков в волне 4 не создаётся.
  | 'CALL_LOGGED'
  // Раздел 4 ТЗ (волна 4) — реестр студентов с «двойным грантом».
  | 'GRANT_CREATE'
  | 'GRANT_UPDATE'
  | 'GRANT_YEAR_ADVANCE'
  | 'GRANT_CLOSE';

export interface ActivityEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: ActivityAction;
  studentId: string | null;
  studentName: string | null;
  details: string;
  payload: any;
  createdAt: string;
}

export async function listActivity(filters: {
  actorId?: string;
  studentId?: string;
  action?: ActivityAction;
  from?: string;
  to?: string;
  take?: number;
} = {}) {
  const { data } = await api.get<ActivityEntry[]>('/activity', { params: filters });
  return data;
}

export const ACTIVITY_LABEL: Record<ActivityAction, string> = {
  STATUS_CHANGE: 'Смена статуса',
  STUDENT_UPDATE: 'Изменение студента',
  STUDENT_CREATE: 'Создание студента',
  STUDENT_DELETE: 'Удаление студента',
  MANAGER_CHANGE: 'Смена менеджера',
  PROGRAM_CHANGE: 'Изменение программы',
  PAYMENT_CREATE: 'Внесён платёж',
  PAYMENT_UPDATE: 'Изменён платёж',
  PAYMENT_SUBMIT: 'Платёж отправлен на одобрение',
  PAYMENT_RECALL: 'Платёж отозван с одобрения',
  PAYMENT_APPROVE: 'Платёж одобрен',
  PAYMENT_REJECT: 'Платёж отклонён',
  PAYMENT_VOID: 'Платёж аннулирован',
  PAYMENT_DELETE: 'Удалён черновик платежа',
  PAYMENT_SCHEDULE_UPDATE: 'Изменён план оплаты',
  USER_CREATE: 'Создан сотрудник',
  USER_ROLE_CHANGE: 'Изменена роль сотрудника',
  USER_DELETE: 'Удалён сотрудник',
  APPLICATION_ARCHIVE: 'Заявка отправлена в архив',
  APPLICATION_UNARCHIVE: 'Заявка возвращена из архива',
  APPLICATION_SOURCE_CHANGE: 'Изменён источник заявки',
  APPLICATION_CLEAR_REPEAT: 'Снята пометка «повторное обращение»',
  CONSULTATION_CREATE: 'Записана консультация',
  CONSULTATION_UPDATE: 'Изменена консультация',
  CONSULTATION_DELETE: 'Удалена консультация',
  CONSULTATION_CONVERT: 'Создана заявка из консультации',
  TASK_AUTO_CREATE: 'Автоматически создана задача',
  TASK_CREATE: 'Создана задача',
  PAYMENT_RECEIPT_ADD: 'Прикреплён чек',
  PAYMENT_RECEIPT_REMOVE: 'Удалён чек',
  DOCUMENT_UPLOAD: 'Загружен документ',
  DOCUMENT_DELETE: 'Удалён документ',
  COMMENT_CREATE: 'Добавлен комментарий',
  COMMENT_UPDATE: 'Изменён комментарий',
  COMMENT_DELETE: 'Удалён комментарий',
  CALL_LOGGED: 'Зафиксирован звонок',
  GRANT_CREATE: 'Добавлен грант',
  GRANT_UPDATE: 'Изменён грант',
  GRANT_YEAR_ADVANCE: 'Переход на следующий год гранта',
  GRANT_CLOSE: 'Грант закрыт',
};

// Группировка пунктов фильтра по доменам — при ~35 значениях плоский список
// в <select> нечитаем. Порядок группы — как в ленте: сначала часто
// используемые (заявки/студенты), затем финансы, задачи, консультации,
// гранты, комментарии, звонки, кадры.
export const ACTIVITY_GROUPS: { label: string; actions: ActivityAction[] }[] = [
  { label: 'Заявки', actions: ['STATUS_CHANGE', 'APPLICATION_ARCHIVE', 'APPLICATION_UNARCHIVE', 'APPLICATION_SOURCE_CHANGE', 'APPLICATION_CLEAR_REPEAT'] },
  { label: 'Студенты', actions: ['STUDENT_CREATE', 'STUDENT_UPDATE', 'STUDENT_DELETE', 'MANAGER_CHANGE', 'PROGRAM_CHANGE'] },
  { label: 'Документы', actions: ['DOCUMENT_UPLOAD', 'DOCUMENT_DELETE'] },
  {
    label: 'Финансы',
    actions: [
      'PAYMENT_CREATE',
      'PAYMENT_UPDATE',
      'PAYMENT_SUBMIT',
      'PAYMENT_RECALL',
      'PAYMENT_APPROVE',
      'PAYMENT_REJECT',
      'PAYMENT_VOID',
      'PAYMENT_DELETE',
      'PAYMENT_SCHEDULE_UPDATE',
      'PAYMENT_RECEIPT_ADD',
      'PAYMENT_RECEIPT_REMOVE',
    ],
  },
  { label: 'Задачи', actions: ['TASK_CREATE', 'TASK_AUTO_CREATE'] },
  { label: 'Консультации', actions: ['CONSULTATION_CREATE', 'CONSULTATION_UPDATE', 'CONSULTATION_DELETE', 'CONSULTATION_CONVERT'] },
  { label: 'Гранты', actions: ['GRANT_CREATE', 'GRANT_UPDATE', 'GRANT_YEAR_ADVANCE', 'GRANT_CLOSE'] },
  { label: 'Комментарии', actions: ['COMMENT_CREATE', 'COMMENT_UPDATE', 'COMMENT_DELETE'] },
  { label: 'Звонки', actions: ['CALL_LOGGED'] },
  { label: 'Сотрудники', actions: ['USER_CREATE', 'USER_ROLE_CHANGE', 'USER_DELETE'] },
];
