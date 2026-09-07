import axios, { type AxiosRequestConfig } from 'axios';
import { api } from './client';

/**
 * 07.09.2026 — загрузка файлов НАПРЯМУЮ на бэкенд, минуя прокси Vercel.
 *
 * Обычные запросы CRM идут на `/admin/api` и переписываются Vercel'ом на
 * Railway — так работают httpOnly-cookie без cross-origin. Но этот прокси
 * обрывает multipart-тела больше ~10 МБ (502 ROUTER_EXTERNAL_TARGET_
 * CONNECTION_ERROR), хотя сам бэкенд спокойно принимает 20 МБ. Сканы
 * паспортов и квитанции на 12–15 МБ падали с непонятной ошибкой.
 *
 * Поэтому файлы уходят прямо на хост Railway. Cookie на чужой домен не
 * уйдёт, и вместо неё бэкенд выдаёт короткоживущий (10 мин) JWT через
 * `POST /auth/upload-token`; его шлём в Authorization: Bearer — guard'ы
 * такой заголовок принимают.
 *
 * Если прямой путь недоступен (сеть, CORS, 502 от самого Railway, токен
 * не принят) — тихо повторяем через прокси, как было раньше. Ошибка от
 * бэкенда с осмысленным ответом (400, 403, 404, 507 «диск полон») отдаётся
 * как есть: это ответ сервера, а не проблема канала.
 *
 * В dev прямой хост не задан → всё идёт через `api` как раньше.
 * Переопределить можно через VITE_UPLOAD_API_URL.
 */
const isDev = (import.meta as any).env?.DEV;
const envDirect: string | undefined = (import.meta as any).env?.VITE_UPLOAD_API_URL;
export const DIRECT_UPLOAD_BASE: string =
  envDirect !== undefined ? envDirect.trim() : isDev ? '' : 'https://grantchina-production.up.railway.app/api';

let cached: { token: string; expiresAt: number } | null = null;

async function uploadToken(): Promise<string> {
  // Запас 60 с: токен, который протухнет во время самой загрузки, бесполезен.
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  const { data } = await api.post<{ token: string; expiresIn: number }>('/auth/upload-token');
  cached = { token: data.token, expiresAt: Date.now() + data.expiresIn * 1000 };
  return data.token;
}

/** Ответ, который имеет смысл повторить через прокси: канал, а не бэкенд. */
function shouldFallback(err: unknown): boolean {
  const e = err as { response?: { status?: number }; code?: string };
  if (!e?.response) return true; // сеть / CORS / таймаут
  const st = e.response.status ?? 0;
  return st === 401 || st === 413 || st === 502 || st === 503 || st === 504;
}

export async function postMultipart<T>(path: string, fd: FormData, config: AxiosRequestConfig = {}): Promise<T> {
  const viaProxy = async () => {
    const { data } = await api.post<T>(path, fd, { ...config, headers: { ...(config.headers ?? {}), 'Content-Type': 'multipart/form-data' } });
    return data;
  };
  if (!DIRECT_UPLOAD_BASE) return viaProxy();
  try {
    const token = await uploadToken();
    const { data } = await axios.post<T>(DIRECT_UPLOAD_BASE + path, fd, {
      ...config,
      withCredentials: false,
      headers: { ...(config.headers ?? {}), 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` },
    });
    return data;
  } catch (err) {
    if (!shouldFallback(err)) throw err;
    cached = null;
    return viaProxy();
  }
}
