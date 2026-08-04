/**
 * Клиент Google Gemini поверх обычного HTTPS.
 *
 * ПОЧЕМУ БЕЗ ОФИЦИАЛЬНОГО ПАКЕТА. Правило проекта — новых npm-зависимостей не
 * добавлять; за всю работу исключение делалось ровно один раз. Gemini имеет
 * простой REST-интерфейс, а весь нужный нам объём — один POST с JSON. SDK дал
 * бы типы и ретраи, но принёс бы с собой дерево зависимостей ради запроса,
 * который умещается в тридцать строк. Node 18+ содержит fetch в стандартной
 * поставке, поэтому и http-клиент не нужен.
 *
 * ЧТО ЭТО НЕ УМЕЕТ, и это осознанно: потоковой выдачи (streaming), загрузки
 * файлов и явного кэширования контекста. Помощнику по регламентам они не
 * нужны — ответ короткий, приходит целиком.
 */

/** Роль реплики в диалоге. У Gemini ответ модели называется 'model', а не 'assistant'. */
export type GeminiRole = 'user' | 'model';

export interface GeminiTurn {
  role: GeminiRole;
  text: string;
}

export interface GeminiRequest {
  model: string;
  apiKey: string;
  system: string;
  turns: GeminiTurn[];
  maxOutputTokens: number;
  /** Секунды до отказа. Без него зависший запрос держал бы воркер бесконечно. */
  timeoutSec?: number;
}

export interface GeminiResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Причина остановки: STOP — нормально, MAX_TOKENS — ответ обрезан, SAFETY — отказ. */
  finishReason: string;
}

/** Ошибка вызова Gemini с сохранённым HTTP-кодом — вызывающий переводит её в понятный текст. */
export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function callGemini(req: GeminiRequest): Promise<GeminiResult> {
  const url = `${ENDPOINT}/${encodeURIComponent(req.model)}:generateContent`;

  // AbortController, а не опция таймаута fetch: последней в Node нет, а без
  // ограничения по времени зависший запрос к внешнему сервису держал бы
  // соединение и воркер до бесконечности.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (req.timeoutSec ?? 60) * 1000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Ключ в ЗАГОЛОВКЕ, а не в query-параметре ?key=. В query он попадает
        // в логи прокси и в историю запросов — это стандартный способ утечь
        // ключом, и Google сам рекомендует заголовок.
        'x-goog-api-key': req.apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: req.system }] },
        contents: req.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: {
          maxOutputTokens: req.maxOutputTokens,
          // Низкая температура намеренно: помощник обязан пересказывать
          // регламент, а не сочинять вариации. Творчество здесь — это
          // выдуманный порядок действий, за которым сотрудник пойдёт в работу.
          temperature: 0.2,
        },
      }),
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      throw new GeminiError('Превышено время ожидания ответа', 504);
    }
    throw new GeminiError('Нет связи с сервисом', 502, String(e?.message ?? e));
  }
  clearTimeout(timer);

  const raw = await res.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new GeminiError('Сервис вернул неожиданный ответ', res.status, raw.slice(0, 300));
  }

  if (!res.ok) {
    const detail = body?.error?.message || raw.slice(0, 300);
    throw new GeminiError(detail || 'Ошибка сервиса', res.status, detail);
  }

  const candidate = body?.candidates?.[0];
  const finishReason: string = candidate?.finishReason || 'STOP';

  // parts может отсутствовать при отказе по правилам безопасности — читаем
  // через опциональную цепочку, иначе получили бы TypeError вместо понятного
  // сообщения пользователю.
  const text: string = (candidate?.content?.parts ?? [])
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();

  return {
    text,
    model: body?.modelVersion || req.model,
    inputTokens: Number(body?.usageMetadata?.promptTokenCount ?? 0),
    outputTokens: Number(body?.usageMetadata?.candidatesTokenCount ?? 0),
    finishReason,
  };
}
