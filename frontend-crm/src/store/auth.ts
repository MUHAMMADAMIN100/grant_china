import { create } from 'zustand';
import type { User } from '../api/types';
import { login as apiLogin, logout as apiLogout, me as apiMe } from '../api/auth';
import { connectRealtime, disconnectRealtime } from '../realtime';

interface AuthState {
  user: User | null;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  init: () => Promise<void>;
}

/**
 * Аутентификация теперь через httpOnly cookies — токен НЕ хранится в
 * localStorage и НЕ доступен JavaScript'у. XSS-эксплойт его не угонит.
 *
 * - login:  backend выставляет cookie, мы только сохраняем user в стейте
 * - logout: backend очищает cookie, мы сбрасываем стейт
 * - init:   просто пробуем GET /auth/me; если cookie живая — 200 + user;
 *           если нет — 401 → не залогинены.
 */
export const useAuth = create<AuthState>((set) => ({
  user: null,
  initialized: false,

  async login(email, password) {
    const { user } = await apiLogin(email, password);
    // Realtime подхватит cookie через withCredentials на самом socket-клиенте
    connectRealtime();
    set({ user });
  },

  async logout() {
    await apiLogout();
    disconnectRealtime();
    set({ user: null });
  },

  async init() {
    try {
      const user = await apiMe();
      connectRealtime();
      set({ user, initialized: true });
    } catch {
      set({ user: null, initialized: true });
    }
  },
}));
