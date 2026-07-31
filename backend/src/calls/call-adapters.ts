import { CallDirection, CallStatus } from '@prisma/client';
import { CallWebhookDto } from './dto/call.dto';

/**
 * ТЗ 6.2 — АДАПТЕРЫ IP-ТЕЛЕФОНИИ.
 *
 * РЕШЕНИЕ ЗАКАЗЧИКА: провайдер АТС пока не выбран, делаем каркас. Отсюда
 * архитектура: вебхук принимает СВОЙ, стабильный формат (CallWebhookDto), а
 * перевод формата конкретной АТС в этот вид делает функция-адаптер.
 *
 * Подключение реального провайдера = добавить ОДНУ функцию в ADAPTERS ниже и
 * прописать её имя в URL вебхука. Ни модель Call, ни права, ни интерфейс, ни
 * сервис при этом не меняются — именно это и означает «каркас готов».
 *
 * Формат URL: POST /api/calls/webhook/:provider
 *   :provider = ключ из ADAPTERS ('generic' — наш собственный формат).
 *
 * ПОЧЕМУ АДАПТЕР ВОЗВРАЩАЕТ null. У всех АТС вебхук срабатывает несколько раз
 * на один звонок (начало, ответ, завершение). В историю нас интересует только
 * ЗАВЕРШЁННОЕ событие — остальные адаптер отбрасывает, возвращая null, и
 * контроллер отвечает 200 (иначе провайдер будет считать доставку неудачной
 * и ретраить её до бесконечности).
 */

export type RawWebhookBody = Record<string, unknown>;

/** Функция-адаптер: сырое тело провайдера → наш нормализованный вид (или null). */
export type CallAdapter = (body: RawWebhookBody) => CallWebhookDto | null;

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

/** Секунды epoch либо ISO-строка → ISO-строка. */
const iso = (v: unknown): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Эвристика: 10 знаков — секунды, 13 — миллисекунды.
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
};

/**
 * 'generic' — НАШ собственный формат. Используется:
 *  - для ручного тестирования вебхука (curl) до выбора провайдера;
 *  - для АТС, которую можно настроить слать произвольный JSON;
 *  - как эталон полей, в который переводят остальные адаптеры.
 */
const genericAdapter: CallAdapter = (body) => {
  const externalId = str(body.externalId) ?? str(body.id) ?? str(body.call_id);
  const phone = str(body.phone) ?? str(body.caller) ?? str(body.from);
  if (!externalId || !phone) return null;

  const rawDirection = (str(body.direction) ?? '').toUpperCase();
  const direction: CallDirection =
    rawDirection === 'OUTBOUND' || rawDirection === 'OUT' ? CallDirection.OUTBOUND : CallDirection.INBOUND;

  const rawStatus = (str(body.status) ?? '').toUpperCase();
  const status = (Object.values(CallStatus) as string[]).includes(rawStatus)
    ? (rawStatus as CallStatus)
    : CallStatus.COMPLETED;

  return {
    externalId,
    phone,
    direction,
    status,
    line: str(body.line) ?? str(body.to),
    startedAt: iso(body.startedAt) ?? iso(body.start),
    answeredAt: iso(body.answeredAt) ?? iso(body.answer),
    endedAt: iso(body.endedAt) ?? iso(body.end),
    durationSec: num(body.durationSec) ?? num(body.duration),
    recordingUrl: str(body.recordingUrl) ?? str(body.recording),
    agent: str(body.agent) ?? str(body.internal) ?? str(body.employee),
    raw: body,
  };
};

/**
 * Пример адаптера под реальную АТС (Zadarma NOTIFY_END). Оставлен как
 * ОБРАЗЕЦ того, сколько кода стоит подключение провайдера — 20 строк. Он
 * отключён по умолчанию: пока в переменных окружения нет ключа Zadarma, этот
 * ключ вебхука просто не используется, а сам код ничему не мешает.
 *
 * Поля взяты из публичной документации формата NOTIFY_END: событие приходит
 * ОДИН раз, в момент завершения разговора, что нам и нужно.
 */
const zadarmaAdapter: CallAdapter = (body) => {
  const event = str(body.event);
  // Игнорируем NOTIFY_START/NOTIFY_INTERNAL — в историю пишем завершённый звонок.
  if (event && event !== 'NOTIFY_END' && event !== 'NOTIFY_OUT_END') return null;

  const externalId = str(body.pbx_call_id) ?? str(body.call_id_with_rec);
  const isOutbound = event === 'NOTIFY_OUT_END';
  const phone = isOutbound ? str(body.destination) : str(body.caller_id);
  if (!externalId || !phone) return null;

  const disposition = (str(body.disposition) ?? '').toLowerCase();
  const status: CallStatus =
    disposition === 'answered'
      ? CallStatus.COMPLETED
      : disposition === 'busy'
        ? CallStatus.BUSY
        : disposition === 'cancel'
          ? CallStatus.CANCELED
          : disposition === 'failed'
            ? CallStatus.FAILED
            : CallStatus.NO_ANSWER;

  return {
    externalId,
    phone,
    direction: isOutbound ? CallDirection.OUTBOUND : CallDirection.INBOUND,
    status,
    line: isOutbound ? str(body.caller_id) : str(body.called_did),
    startedAt: iso(body.call_start),
    durationSec: num(body.duration),
    recordingUrl: str(body.call_id_with_rec) ? undefined : undefined,
    agent: str(body.internal),
    raw: body,
  };
};

export const CALL_ADAPTERS: Record<string, CallAdapter> = {
  generic: genericAdapter,
  zadarma: zadarmaAdapter,
};

export function resolveAdapter(provider: string): CallAdapter | null {
  return CALL_ADAPTERS[provider.toLowerCase()] ?? null;
}
