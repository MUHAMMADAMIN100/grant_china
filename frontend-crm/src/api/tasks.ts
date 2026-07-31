import { api } from './client';
import type { Task, TaskStatus } from './types';

export interface TaskFilters {
  mine?: boolean;
  search?: string;
  /** ТЗ 3.2 — «мои задачи по срокам». ISO-строки. */
  dueFrom?: string;
  dueTo?: string;
  /** true — только просроченные незакрытые (dueDate < now, status !== DONE). */
  overdue?: boolean;
}

export async function listTasks(filters: TaskFilters = {}) {
  const { data } = await api.get<Task[]>('/tasks', {
    params: {
      mine: filters.mine ? 'true' : undefined,
      search: filters.search || undefined,
      dueFrom: filters.dueFrom || undefined,
      dueTo: filters.dueTo || undefined,
      overdue: filters.overdue ? 'true' : undefined,
    },
  });
  return data;
}

export async function getTask(id: string) {
  const { data } = await api.get<Task>(`/tasks/${id}`);
  return data;
}

export async function createTask(payload: {
  title: string;
  description: string;
  assignedToId: string;
  dueDate?: string;
}) {
  const { data } = await api.post<Task>('/tasks', payload);
  return data;
}

export async function updateTask(
  id: string,
  payload: Partial<{
    title: string;
    description: string;
    status: TaskStatus;
    assignedToId: string;
    /** string — новый срок, null — снять срок. */
    dueDate: string | null;
  }>,
) {
  const { data } = await api.patch<Task>(`/tasks/${id}`, payload);
  return data;
}

export async function deleteTask(id: string) {
  const { data } = await api.delete(`/tasks/${id}`);
  return data;
}
