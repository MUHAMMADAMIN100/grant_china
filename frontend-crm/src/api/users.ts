import { api } from './client';
import type { Role, User } from './types';

export async function listUsers() {
  const { data } = await api.get<User[]>('/users');
  return data;
}

export async function createUser(payload: { email: string; fullName: string; password: string; role: Role }) {
  const { data } = await api.post<User>('/users', payload);
  return data;
}

export async function updateUser(id: string, payload: Partial<{ email: string; fullName: string; password: string; role: Role }>) {
  const { data } = await api.patch<User>(`/users/${id}`, payload);
  return data;
}

export async function deleteUser(id: string) {
  const { data } = await api.delete(`/users/${id}`);
  return data;
}
