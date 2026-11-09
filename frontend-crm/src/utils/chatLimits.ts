/**
 * 29.10.2026 — правила отправки в Instagram и WhatsApp. Те же числа живут на
 * сервере (backend/src/messaging/meta/meta.config.ts) — меняются вместе.
 */

export const isMetaChannel = (channel: string | null | undefined): channel is 'INSTAGRAM' | 'WHATSAPP' =>
  channel === 'INSTAGRAM' || channel === 'WHATSAPP';

/** Instagram — 1000 байт, WhatsApp — 4096. Кириллица — два байта на букву. */
export const TEXT_LIMIT_BYTES: Record<'INSTAGRAM' | 'WHATSAPP', number> = { INSTAGRAM: 1000, WHATSAPP: 4096 };

export const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * Как сервер режет длинный текст (splitByBytes в meta-chats.service.ts):
 * по пробелу или переносу строки, если он во второй половине куска, иначе — по пределу.
 * Нужен, чтобы счётчик честно говорил, сколько сообщений уйдёт.
 */
export function splitByBytes(text: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (byteLength(rest) > limit) {
    let cut = 0;
    let bytes = 0;
    for (const ch of rest) {
      const b = byteLength(ch);
      if (bytes + b > limit) break;
      bytes += b;
      cut += ch.length;
    }
    const head = rest.slice(0, cut);
    const soft = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
    const at = soft > cut * 0.5 ? soft : cut;
    const piece = rest.slice(0, at).trimEnd();
    if (piece) parts.push(piece);
    rest = rest.slice(at).trimStart();
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Окно открыто, пока не прошли сутки с последнего сообщения клиента. */
export function windowOpen(lastIncomingAt: string | null | undefined, now = Date.now()): boolean {
  return !!lastIncomingAt && now - new Date(lastIncomingAt).getTime() <= REPLY_WINDOW_MS;
}

const MB = 1024 * 1024;
export const VOICE_MAX_SECONDS = 300;
export const VOICE_MAX_BYTES = 10 * MB;

export type ChatFileKind = 'IMAGE' | 'VIDEO' | 'FILE';

/** Что за файл выбрали: фото, видео (09.11.2026) или PDF. null — такой не отправить. */
export function chatFileKind(file: File): ChatFileKind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'FILE';
  if (['image/jpeg', 'image/png'].includes(file.type) || /\.(jpe?g|png)$/.test(name)) return 'IMAGE';
  if (['video/mp4', 'video/quicktime'].includes(file.type) || /\.(mp4|mov)$/.test(name)) return 'VIDEO';
  return null;
}

/** Пределы — те же, что на сервере (OUTGOING_LIMITS): видео Instagram 25 МБ, WhatsApp 16 МБ. */
const FILE_LIMIT: Record<ChatFileKind, Record<'INSTAGRAM' | 'WHATSAPP', number>> = {
  IMAGE: { INSTAGRAM: 8 * MB, WHATSAPP: 5 * MB },
  VIDEO: { INSTAGRAM: 25 * MB, WHATSAPP: 16 * MB },
  FILE: { INSTAGRAM: 25 * MB, WHATSAPP: 25 * MB },
};
const TOO_BIG: Record<ChatFileKind, string> = { IMAGE: 'сожмите фото', VIDEO: 'выберите ролик короче или сожмите его', FILE: 'уменьшите PDF' };

/** null — можно отправлять, иначе текст причины. */
export function checkChatFile(channel: 'INSTAGRAM' | 'WHATSAPP', file: File): string | null {
  const kind = chatFileKind(file);
  if (!kind) return 'Можно отправить фото JPG или PNG, видео MP4 или MOV либо документ PDF.';
  const limit = FILE_LIMIT[kind][channel];
  if (file.size > limit) return `Файл больше ${Math.round(limit / MB)} МБ — ${TOO_BIG[kind]}.`;
  return null;
}

/** Причины отказа — те же фразы, что на сервере (FAILURE_TEXT). */
export const FAILURE_TEXT: Record<string, string> = {
  TOKEN_INVALID: 'Ключ доступа Meta больше не действует — сообщите руководителю.',
  WINDOW_CLOSED: 'Прошло больше 24 часов с последнего сообщения клиента — Meta не разрешает писать первым.',
  UNAVAILABLE: 'Этому человеку нельзя написать: он ограничил сообщения или удалил аккаунт.',
  TEST_RECIPIENT: 'Тестовый номер Meta пишет только номерам из списка получателей.',
  NETWORK: 'Meta не ответила — повторите отправку через минуту.',
  REJECTED: 'Meta отклонила сообщение.',
};
