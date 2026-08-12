import axios from 'axios';
import { connectStudentRealtime, disconnectStudentRealtime } from './realtime';

// Same-origin: в production используем `/api` (Vercel rewrite в vercel.json
// проксирует на Railway backend). Так browser считает запросы same-origin
// и cookies работают с SameSite=Lax во ВСЕХ браузерах.
const isDev = (import.meta as any).env?.DEV;
const _envApiUrl: string | undefined = (import.meta as any).env?.VITE_API_URL;
// В production игнорируем env-URL если он указывает на localhost — это
// dev-default который мог остаться в Vercel env. Иначе на проде клик
// по документу открыл бы http://localhost:3001/uploads/... и упал в
// ERR_CONNECTION_REFUSED у юзера.
const API_URL =
  _envApiUrl && (isDev || !/localhost|127\.0\.0\.1/.test(_envApiUrl))
    ? _envApiUrl
    : isDev
      ? 'http://localhost:3001/api'
      : '/api';
export const API_BASE = API_URL.replace(/\/api$/, '');

/**
 * Строит URL для отдачи файла бэкендом (документ, фото студента, картинка
 * программы). Защита от пары крайних случаев:
 *  1. `url` уже абсолютный с localhost (старые сборки или env неправильно
 *     заданы) → в production отрезаем хост и оставляем только path, чтобы
 *     запрос пошёл через Vercel rewrite `/uploads/*` → Railway.
 *  2. `url` уже абсолютный с другим хостом → возвращаем как есть.
 *  3. `url` относительный (`/uploads/...`) → префиксим API_BASE (в
 *     production это пустая строка → same-origin).
 */
export function buildFileUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Абсолютный URL
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      const isLocalhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (isLocalhost && !isDev) {
        // Заменяем localhost на текущий origin — Vercel перепроксирует
        return `${u.pathname}${u.search}${u.hash}`;
      }
    } catch {
      /* malformed — отдадим как есть */
    }
    return url;
  }
  // Относительный
  return `${API_BASE}${url}`;
}

/**
 * Аутентификация студента — теперь через httpOnly cookie `gc_student_token`,
 * выдаваемую backend'ом при POST /student-auth/login. Токен НЕ в localStorage —
 * XSS-эксплойт не угоняет сессию.
 *
 * Старый ключ `grantchina_student_token` чистим при инициализации модуля,
 * чтобы оставшийся в браузере legacy-токен не путал realtime/UI.
 */
const LEGACY_TOKEN_KEY = 'grantchina_student_token';
try {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch {
  /* SSR / non-browser env */
}

const client = axios.create({
  baseURL: API_URL,
  withCredentials: true, // браузер автоматически шлёт httpOnly cookie
});

/**
 * Проверка «залогинены ли мы». Раньше делалось `!!localStorage.getItem(...)`,
 * теперь — асинхронный пинг GET /student-auth/me. Лёгкий запрос; статус 200
 * = есть валидная cookie, 401/403 = нет. Используется на старте кабинета.
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    await client.get('/student-auth/me');
    return true;
  } catch {
    return false;
  }
}

export type StudentDoc = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  type: string;
  createdAt: string;
  /** true → студент не может скачать файл (бэкенд занулил url). */
  restricted?: boolean;
};

export type StudentMe = {
  id: string;
  fullName: string;
  email: string | null;
  phones: string[];
  direction: 'BACHELOR' | 'MASTER' | 'LANGUAGE';
  cabinet: number;
  status: 'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'ARCHIVED';
  comment: string | null;
  photoUrl: string | null;
  /**
   * ТЗ v3 раздел 5 — статус визы студента. Скалярное поле Student, поэтому
   * приходит в /student-auth/me автоматически (там `include`); попадание
   * в ответ — требование ТЗ, а не утечка: индикатор визы обязан быть
   * в личном кабинете. Всегда булево (@default(false) в схеме), не `?`.
   */
  visaReceived: boolean;
  /** Когда визу отметили полученной. null — визы ещё нет. */
  visaReceivedAt: string | null;
  documents: StudentDoc[];
  manager: { id: string; fullName: string; email: string } | null;
  chinaManager: { id: string; fullName: string; email: string } | null;
  applications?: { id: string; status: string; createdAt: string }[];
  createdAt: string;
};

export async function studentLogin(email: string, password: string) {
  const { data } = await client.post<{ student: { id: string; email: string; fullName: string } }>(
    '/student-auth/login',
    { email, password },
  );
  // Cookie уже установлена backend'ом — открываем socket-соединение,
  // оно тоже использует withCredentials.
  connectStudentRealtime();
  return data;
}

export async function studentLogout() {
  await client.post('/student-auth/logout').catch(() => {});
  disconnectStudentRealtime();
}

export async function studentMe() {
  const { data } = await client.get<StudentMe>('/student-auth/me');
  return data;
}

/**
 * Смена фото профиля из кабинета (доработка 12.08.2026). Сервер принимает
 * только изображения; после ответа новое фото уже видно менеджерам в CRM —
 * бэкенд шлёт им student:updated.
 */
export async function studentUploadPhoto(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await client.post<{ photoUrl: string }>('/student-auth/photo', fd);
  return data;
}

export async function studentUploadDocument(file: File, type: string) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', type);
  const { data } = await client.post<StudentDoc>('/student-auth/documents', fd);
  return data;
}

export async function studentDeleteDocument(id: string) {
  const { data } = await client.delete(`/student-auth/documents/${id}`);
  return data;
}

export type ApplicationFormData = any;

export async function getStudentForm() {
  const { data } = await client.get<{ form: ApplicationFormData | null }>('/student-auth/form');
  return data.form;
}

export async function saveStudentForm(form: ApplicationFormData) {
  const { data } = await client.patch<{ form: ApplicationFormData }>('/student-auth/form', form);
  return data.form;
}

export interface StudentProgram {
  id: string;
  name: string;
  university: string;
  city: string;
  major: string;
  direction: 'BACHELOR' | 'MASTER' | 'LANGUAGE';
  cost: number;
  currency: string;
  duration: string | null;
  language: string | null;
  description: string | null;
  imageUrl: string | null;
  published: boolean;
  createdAt: string;
}

export async function listStudentPrograms(filters: {
  city?: string;
  major?: string;
  direction?: string;
  minCost?: number;
  maxCost?: number;
  search?: string;
} = {}) {
  const { data } = await client.get<StudentProgram[]>('/student-auth/programs', { params: filters });
  return data;
}

export async function getStudentProgramFilters() {
  const { data } = await client.get<{ cities: string[]; majors: string[] }>('/student-auth/programs/filters');
  return data;
}
