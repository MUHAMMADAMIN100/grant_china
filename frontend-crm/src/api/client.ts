import axios from 'axios';

const baseURL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api';

/**
 * Axios-клиент для CRM API.
 *
 * `withCredentials: true` — браузер автоматически отправит httpOnly cookie
 * `gc_token` с каждым запросом. Авторизация больше НЕ через localStorage,
 * чтобы XSS не мог угнать токен.
 *
 * Для cross-origin это требует на backend:
 *   - CORS с credentials: true
 *   - Cookie с SameSite=None; Secure (управляется env COOKIE_SAMESITE)
 */
export const api = axios.create({
  baseURL,
  withCredentials: true,
});

/**
 * Считаем что юзер «не авторизован» если backend вернул:
 *  - 401 (правильный код от наших новых guard'ов)
 *  - 403 + сообщение содержащее "авторизац" (legacy форма от старых ошибок
 *    типа "Требуется авторизация" — была до миграции на 401).
 */
function isAuthError(err: any): boolean {
  const status = err?.response?.status;
  if (status === 401) return true;
  if (status === 403) {
    const msg: string = String(err?.response?.data?.message || '').toLowerCase();
    if (msg.includes('авторизац') || msg.includes('требуется') || msg.includes('просрочен')) {
      return true;
    }
  }
  return false;
}

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (isAuthError(err)) {
      // Учитываем basename CRM (/admin) — после basename идёт /login
      const loginPath = '/admin/login';
      if (!location.pathname.endsWith('/login')) {
        location.href = loginPath;
      }
    }
    return Promise.reject(err);
  },
);
