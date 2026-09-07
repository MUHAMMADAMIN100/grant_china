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
 * 07.09.2026 — файлы из кабинета уходят НАПРЯМУЮ на бэкенд, минуя прокси
 * Vercel: прокси обрывает multipart-тела больше ~10 МБ (502), а бэкенд
 * принимает 20. Cookie на домен Railway не уйдёт, поэтому берём
 * короткоживущий токен `POST /student-auth/upload-token` и шлём его в
 * Authorization: Bearer. Если прямой путь недоступен (сеть/CORS/502) —
 * повторяем через прокси, как раньше. Ответ бэкенда по существу (400,
 * 507 «диск полон») отдаём как есть. В dev прямой хост не задан.
 */
const _envUpload: string | undefined = (import.meta as any).env?.VITE_UPLOAD_API_URL;
const DIRECT_UPLOAD_BASE: string =
  _envUpload !== undefined ? _envUpload.trim() : isDev ? '' : 'https://grantchina-production.up.railway.app/api';
let _uploadToken: { token: string; expiresAt: number } | null = null;

async function uploadToken(): Promise<string> {
  if (_uploadToken && _uploadToken.expiresAt - Date.now() > 60_000) return _uploadToken.token;
  const { data } = await client.post<{ token: string; expiresIn: number }>('/student-auth/upload-token');
  _uploadToken = { token: data.token, expiresAt: Date.now() + data.expiresIn * 1000 };
  return data.token;
}

async function postMultipart<T>(path: string, fd: FormData): Promise<T> {
  const viaProxy = async () => (await client.post<T>(path, fd)).data;
  if (!DIRECT_UPLOAD_BASE) return viaProxy();
  try {
    const token = await uploadToken();
    const { data } = await axios.post<T>(DIRECT_UPLOAD_BASE + path, fd, {
      withCredentials: false,
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch (err) {
    const e = err as { response?: { status?: number } };
    const st = e?.response?.status;
    const channelProblem = !e?.response || st === 401 || st === 413 || st === 502 || st === 503 || st === 504;
    if (!channelProblem) throw err;
    _uploadToken = null;
    return viaProxy();
  }
}

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
  /**
   * 26.08.2026 — отметка о визе, которую студент подал сам. Ожидает решения,
   * если visaClaimedAt задан, а visaClaimReviewedAt пуст. После решения:
   * visaClaimApproved true/false и (при отказе) visaClaimNote.
   */
  visaClaimReceived?: boolean | null;
  visaClaimedAt?: string | null;
  visaClaimReviewedAt?: string | null;
  visaClaimApproved?: boolean | null;
  visaClaimNote?: string | null;
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
  return postMultipart<{ photoUrl: string }>('/student-auth/photo', fd);
}

export async function studentUploadDocument(file: File, type: string) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('type', type);
  return postMultipart<StudentDoc>('/student-auth/documents', fd);
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

// ============================================================================
// 26.08.2026 — билет и отметка о визе из личного кабинета.
// Контракт зеркалит backend/src/student-auth/student-tickets.controller.ts
// и StudentAuthService.claimVisa(). Бэкенд не отдаёт url файла: файлы
// билетов студенту через /uploads недоступны, поэтому в StudentTicketDoc его нет.
// ============================================================================

export type StudentTicketStatus = 'BOOKED' | 'PURCHASED' | 'CHANGED' | 'CANCELLED';
export type StudentTicketReview = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface StudentTicketDoc {
  id: string;
  originalName: string;
  size: number;
  createdAt: string;
}

export interface StudentTicket {
  id: string;
  destinationCity: string;
  departureAt: string;
  arrivalAt: string | null;
  flightNumber: string;
  airline: string | null;
  status: StudentTicketStatus;
  comment: string | null;
  submittedByStudentAt: string | null;
  /** null — билет завёл менеджер, он не проходит проверку. */
  reviewStatus: StudentTicketReview | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  staffEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: StudentTicketDoc[];
}

export interface StudentTicketPayload {
  destinationCity: string;
  /** ISO — new Date(datetime-local).toISOString(). */
  departureAt: string;
  arrivalAt?: string;
  flightNumber: string;
  airline?: string;
  status?: 'BOOKED' | 'PURCHASED';
  comment?: string;
}

export async function listMyTickets() {
  const { data } = await client.get<{ items: StudentTicket[]; pendingId: string | null }>('/student-auth/tickets');
  return data;
}

export async function listTicketCities() {
  const { data } = await client.get<{ items: { value: string; latin: string }[] }>('/student-auth/tickets/cities');
  return data.items;
}

export async function submitMyTicket(payload: StudentTicketPayload, file?: File | null) {
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') fd.append(k, String(v));
  });
  if (file) fd.append('file', file);
  return postMultipart<StudentTicket>('/student-auth/tickets', fd);
}

export async function updateMyTicket(id: string, payload: Partial<StudentTicketPayload> & { arrivalAt?: string }) {
  const { data } = await client.patch<StudentTicket>(`/student-auth/tickets/${id}`, payload);
  return data;
}

export async function withdrawMyTicket(id: string) {
  const { data } = await client.delete<{ ok: true }>(`/student-auth/tickets/${id}`);
  return data;
}

export async function attachMyTicketFile(id: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return postMultipart<StudentTicketDoc>(`/student-auth/tickets/${id}/documents`, fd);
}

export async function removeMyTicketFile(id: string, docId: string) {
  const { data } = await client.delete<{ ok: true }>(`/student-auth/tickets/${id}/documents/${docId}`);
  return data;
}

/** Отметка «визу получил» / «визы ещё нет» — уходит менеджеру на подтверждение. */
export async function claimVisa(received: boolean) {
  const { data } = await client.post<{ ok: true }>('/student-auth/visa-claim', { received });
  return data;
}

export async function withdrawVisaClaim() {
  const { data } = await client.delete<{ ok: true }>('/student-auth/visa-claim');
  return data;
}
