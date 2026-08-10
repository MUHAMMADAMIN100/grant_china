import { api } from './client';
import type { Direction, Document, Student, StudentStatus } from './types';

export interface StudentFilters {
  direction?: Direction;
  status?: StudentStatus;
  cabinet?: number;
  search?: string;
  mine?: boolean;
  /** Фильтр по менеджеру (TJ или CN) — userId */
  manager?: string;
  /** Фильтр по этапу заявки (или специальный StudentStatus). */
  stage?: string;
  /**
   * Раздел 4 ТЗ (волна 4) — реестр «двойных грантов» прямо в общем списке
   * студентов: 'multi' — есть незакрытый грант с totalYears > 1, 'any' —
   * есть хоть какой-то незакрытый грант, 'none' — грантов нет вовсе.
   * Без фильтра (undefined) условие не применяется.
   */
  grant?: 'multi' | 'any' | 'none';
  /** Серверная пагинация: страница (с 1) + размер. Если не передано —
   *  бэкенд возвращает массив (старый поведение). */
  page?: number;
  pageSize?: number;
}

export interface StudentsPage {
  items: Student[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listStudents(filters: StudentFilters = {}) {
  const { data } = await api.get<Student[]>('/students', { params: filters });
  return data;
}

/** Серверная пагинация — всегда возвращает {items,total,page,pageSize}. */
export async function listStudentsPaged(filters: StudentFilters & { page: number; pageSize: number }) {
  const { data } = await api.get<StudentsPage>('/students', { params: filters });
  return data;
}

export async function getStudent(id: string) {
  const { data } = await api.get<Student>(`/students/${id}`);
  return data;
}

export async function ensureStudentApplication(id: string) {
  const { data } = await api.post(`/students/${id}/ensure-application`);
  return data;
}

export async function updateStudentForm(id: string, form: any) {
  const { data } = await api.patch(`/students/${id}/form`, form);
  return data;
}

/**
 * ТЗ 3.1: source/sourceDetail не поля Student — они уезжают в ЗАЯВКУ, которую
 * бэкенд создаёт вместе со студентом (students.service.buildApplicationSeed).
 * Поэтому тип шире, чем Partial<Student>: иначе TS ругался бы на «лишние»
 * свойства, а без них заявка из CRM навсегда оставалась бы без источника.
 */
export type CreateStudentPayload = Partial<Student> & {
  source?: string;
  sourceDetail?: string;
};

export async function createStudent(payload: CreateStudentPayload) {
  const { data } = await api.post<Student>('/students', payload);
  return data;
}

export async function updateStudent(id: string, payload: Partial<Student>) {
  const { data } = await api.patch<Student>(`/students/${id}`, payload);
  return data;
}

export async function assignStudentManager(
  id: string,
  patch: { managerId?: string | null; chinaManagerId?: string | null },
) {
  const { data } = await api.patch<Student>(`/students/${id}/manager`, patch);
  return data;
}

export async function deleteStudent(id: string) {
  const { data } = await api.delete(`/students/${id}`);
  return data;
}

/**
 * ТЗ «Разделение воронок» — передача студента в китайский офис. Сервер сам
 * перепроверяет и право (руководство либо назначенный таджикский менеджер),
 * и получателя (обязан реально работать по Китаю) — см.
 * backend/src/students/students.service.ts transferToChina().
 */
/**
 * Кандидаты на приём студента в Китае.
 *
 * Отдельный узкий эндпоинт, а НЕ общий список сотрудников: GET /users закрыт
 * для рядового менеджера (@Roles(FOUNDER, ADMIN)), и окно выбора у него
 * открывалось пустым — кнопка «Передать» есть, а выбрать некого. Здесь сервер
 * отдаёт только имя и идентификатор менеджеров, работающих по Китаю, и
 * проверяет то же право, что и на саму передачу.
 */
export async function listChinaTransferCandidates(id: string) {
  const { data } = await api.get<{ id: string; fullName: string }[]>(`/students/${id}/china-managers`);
  return data;
}

export async function transferStudentToChina(id: string, chinaManagerId: string) {
  const { data } = await api.post<Student>(`/students/${id}/transfer-to-china`, { chinaManagerId });
  return data;
}

/** Возврат в таджикский офис — сервер разрешает только Основателю. */
export async function returnStudentFromChina(id: string) {
  const { data } = await api.post<Student>(`/students/${id}/return-from-china`);
  return data;
}

export async function regenerateStudentPassword(id: string) {
  const { data } = await api.post<{ email: string; password: string }>(
    `/students/${id}/regenerate-password`,
  );
  return data;
}

export async function uploadPhoto(id: string, file: File) {
  const fd = new FormData(); fd.append('file', file);
  const { data } = await api.post<Student>(`/students/${id}/photo`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function uploadDocument(id: string, file: File, type: string = 'OTHER') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', type);
  const { data } = await api.post<Document>(`/students/${id}/documents`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deleteDocument(docId: string) {
  const { data } = await api.delete(`/students/documents/${docId}`);
  return data;
}

export async function studentStats() {
  const { data } = await api.get('/students/stats');
  return data;
}
