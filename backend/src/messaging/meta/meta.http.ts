/**
 * 29.10.2026 — запросы к Graph API Meta и разбор её отказов.
 *
 * Ключ — только в заголовке Authorization, никогда в адресе: адреса попадают
 * в журналы. Ответа ждём не дольше 15 секунд. Отказ Meta (error.code,
 * error.error_subcode) превращается в MetaApiError с нашим кодом причины —
 * по нему CRM пишет человеку понятную фразу.
 */

export type MetaFailure = 'TOKEN_INVALID' | 'WINDOW_CLOSED' | 'UNAVAILABLE' | 'TEST_RECIPIENT' | 'NETWORK' | 'REJECTED';

export class MetaApiError extends Error {
  constructor(
    public readonly reason: MetaFailure,
    public readonly code: number | null,
    public readonly subcode: number | null,
    message: string,
  ) {
    super(message);
  }
  /** Для errorDetail: «131047» или «10/2534022». */
  get detail(): string | null {
    if (this.code == null) return null;
    return this.subcode ? `${this.code}/${this.subcode}` : String(this.code);
  }
}

/** Таблица кодов из инструкции (шаг 6). */
export function classifyMetaError(channel: 'INSTAGRAM' | 'WHATSAPP', code: number | null, subcode: number | null): MetaFailure {
  if (code === null) return 'NETWORK';
  if (code === 190) return 'TOKEN_INVALID';
  if (channel === 'INSTAGRAM') {
    if (code === 10 && subcode === 2534022) return 'WINDOW_CLOSED';
    if (code === 551 || subcode === 2534014 || subcode === 2018001) return 'UNAVAILABLE';
    return 'REJECTED';
  }
  if (code === 131047 || code === 470) return 'WINDOW_CLOSED';
  if (code === 131026) return 'UNAVAILABLE';
  if (code === 131030) return 'TEST_RECIPIENT';
  if (code === 130429 || code === 131056 || code === 131000) return 'NETWORK';
  return 'REJECTED';
}

const TIMEOUT_MS = 15_000;

export async function graphRequest<T>(
  channel: 'INSTAGRAM' | 'WHATSAPP',
  url: string,
  init: { method?: 'GET' | 'POST'; token?: string; body?: unknown } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new MetaApiError('NETWORK', null, null, `Meta не ответила: ${(e as Error).name === 'AbortError' ? 'таймаут 15 с' : (e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || json?.error) {
    const code = typeof json?.error?.code === 'number' ? json.error.code : res.status >= 500 ? null : res.status;
    const subcode = typeof json?.error?.error_subcode === 'number' ? json.error.error_subcode : null;
    const reason = res.status >= 500 && code === null ? 'NETWORK' : classifyMetaError(channel, code, subcode);
    throw new MetaApiError(reason, code, subcode, json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

/** Первые 16 знаков SHA-256 ключа: «тот же ли это ключ», без хранения самого ключа в отметках. */
export function tokenFingerprint(token: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}
