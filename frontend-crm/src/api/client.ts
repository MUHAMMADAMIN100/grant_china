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

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      // Учитываем basename CRM (/admin) — после basename идёт /login
      const loginPath = '/admin/login';
      if (!location.pathname.endsWith('/login')) {
        location.href = loginPath;
      }
    }
    return Promise.reject(err);
  },
);
