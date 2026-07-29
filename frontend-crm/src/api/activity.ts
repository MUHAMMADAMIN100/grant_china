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
  | 'USER_DELETE';

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
};
