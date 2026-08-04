import { api } from './client';
import type { Region, Role, User } from './types';

export async function listUsers(search?: string) {
  const { data } = await api.get<User[]>('/users', {
    params: { search: search ? search : undefined },
  });
  return data;
}

/**
 * region необязателен: бэкенд подставит BOTH, если поле не пришло. Держим его
 * опциональным именно поэтому — чтобы формы, которым регион не нужен, не были
 * обязаны слать значение (ТЗ v3 р4).
 */
export async function createUser(payload: { email: string; fullName: string; password: string; role: Role; region?: Region }) {
  const { data } = await api.post<User>('/users', payload);
  return data;
}

export async function updateUser(id: string, payload: Partial<{ email: string; fullName: string; password: string; role: Role; region: Region }>) {
  const { data } = await api.patch<User>(`/users/${id}`, payload);
  return data;
}

export async function deleteUser(id: string) {
  const { data } = await api.delete(`/users/${id}`);
  return data;
}
