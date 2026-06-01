import { api } from './client';
import type { User } from './types';

/**
 * Логин. Backend выставит httpOnly cookie `gc_token` — фронт его не видит.
 * Поле `token` в ответе осталось для backward-compat, но не используется.
 */
export async function login(email: string, password: string) {
  const { data } = await api.post<{ user: User }>('/auth/login', { email, password });
  return data;
}

/** Логаут — backend очищает httpOnly cookie. */
export async function logout() {
  await api.post('/auth/logout').catch(() => {});
}

export async function me() {
  const { data } = await api.get<User>('/auth/me');
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const { data } = await api.post<{ ok: true }>('/auth/change-password', {
    currentPassword,
    newPassword,
  });
  return data;
}
