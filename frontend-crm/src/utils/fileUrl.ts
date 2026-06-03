/**
 * Строит URL для отдачи файла бэкендом (документ, фото студента).
 *
 * Защищает от двух крайних случаев на проде:
 *  1. `VITE_API_URL` остался указывать на `http://localhost:3001/api` —
 *     тогда `${API_BASE}${doc.url}` дало бы `http://localhost:3001/...`
 *     и клик по документу падал в ERR_CONNECTION_REFUSED.
 *  2. В БД уже сохранён абсолютный URL с `localhost` (старые загрузки) —
 *     даже если env уже починен, ссылка из БД всё равно ведёт никуда.
 *
 * Стратегия:
 *  - Если url абсолютный и хост = localhost/127.0.0.1, а мы не в dev —
 *    отрезаем хост, оставляем только path. Запрос пойдёт по текущему
 *    origin, и Vercel rewrite `/admin/uploads/*` → Railway сработает.
 *  - Если url абсолютный с другим хостом — возвращаем как есть.
 *  - Если url относительный — префиксим API_BASE. В production API_BASE
 *    пустой → URL остаётся относительным → same-origin.
 */
const isDev = (import.meta as any).env?.DEV;
const _envApiUrl: string | undefined = (import.meta as any).env?.VITE_API_URL;
const API_URL =
  _envApiUrl && (isDev || !/localhost|127\.0\.0\.1/.test(_envApiUrl))
    ? _envApiUrl
    : isDev
      ? 'http://localhost:3001/api'
      : '/admin/api';

/** Базовый URL backend'а без `/api` (для /uploads, etc). */
export const API_BASE: string = API_URL.replace(/\/api$/, '');

export function buildFileUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      const isLocalhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (isLocalhost && !isDev) {
        // В production отрезаем localhost — пусть запрос идёт через same-origin.
        // Vercel rewrite перепроксирует /uploads/* на Railway.
        // CRM mounted at /admin → пути типа /uploads должны открываться как
        // /admin/uploads чтобы попасть в rewrite.
        const path = u.pathname.startsWith('/uploads')
          ? `/admin${u.pathname}`
          : u.pathname;
        return `${path}${u.search}${u.hash}`;
      }
    } catch {
      /* malformed — отдадим как есть */
    }
    return url;
  }
  // Относительный path
  if (url.startsWith('/uploads') && !isDev && !API_BASE) {
    // Префиксим /admin чтобы Vercel rewrite сработал
    return `/admin${url}`;
  }
  return `${API_BASE}${url}`;
}
