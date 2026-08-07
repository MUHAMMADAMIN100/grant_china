/**
 * Единая проверка Origin для CORS (HTTP, main.ts) и WebSocket
 * (realtime.gateway.ts, socket.io принимает ТОТ ЖЕ тип CorsOptions.origin,
 * что и express `cors`). Раньше логика была продублирована в двух местах —
 * WebSocket-гейтвей вообще не проверял Origin (`origin: true` — отражает
 * ЛЮБОЙ), что позволяло странице атакующего открыть socket.io-соединение
 * с cookie жертвы (polling-транспорт — это обычный XHR с credentials) и
 * слушать поток staff-событий. Теперь оба места используют одну функцию —
 * расхождение исключено.
 *
 * ВАЖНО про архитектуру прода: фронтенды на Vercel проксируют трафик к
 * Railway СЕРВЕР-К-СЕРВЕРУ через vercel.json rewrites (/admin/api/*,
 * /admin/socket.io/*). Браузер обращается к своему же origin (Vercel),
 * заголовок Origin до Railway в проде вообще не доходит — сюда прилетает
 * undefined, и мы его пропускаем (ветка `if (!origin)` ниже). Поэтому CORS
 * здесь — это защита ТОЛЬКО для прямых (не через rewrite) обращений к
 * Railway-домену: локальная разработка (localhost:5173/5174 → localhost:3001)
 * и любые сторонние сайты, которые попытаются обратиться к API/сокету
 * напрямую с cookie браузера жертвы.
 */

// Явный список — безопасен, в отличие от wildcard-паттернов.
const ALWAYS_ALLOWED_HOSTS = [
  'grantchina.tj',
  'www.grantchina.tj',
  'grant-china-crm.vercel.app',
  'grant-china-landing.vercel.app',
];

/**
 * Адреса разработки — ТОЛЬКО вне продакшена.
 *
 * Раньше они лежали в списке выше, то есть действовали и на боевом сервере.
 * Эта функция обслуживает три вещи разом: CORS для HTTP, рукопожатие сокета и
 * запасную проверку CSRF. Боевая cookie ставится с SameSite=None и
 * credentials:true — значит любой процесс, слушающий у сотрудника на
 * localhost:5173 (чужой dev-сервер, локально поставленная программа,
 * вредоносный npm-пакет в чьём-то проекте), получал право читать ответы
 * боевого API и открывать сокет с его cookie.
 *
 * Нужен доступ с нестандартного адреса — задайте CORS_ORIGINS, он работает
 * в любом окружении.
 */
const DEV_ALLOWED_HOSTS = ['localhost:5173', 'localhost:5174', '127.0.0.1:5173', '127.0.0.1:5174'];

function isDevAllowed(host: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return DEV_ALLOWED_HOSTS.includes(host);
}

function parseCorsOriginsEnv(): string[] {
  // Читаем process.env напрямую (не через ConfigService): у WebSocketGateway
  // опции cors — это метаданные декоратора, они вычисляются один раз при
  // ЗАГРУЗКЕ модуля (до того, как Nest поднимет DI-контейнер и ConfigModule
  // прочитает .env), а checkOrigin вызывается заведомо позже — на каждый
  // реальный handshake, когда process.env уже полностью инициализирован.
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Сигнатура колбэка совпадает и у express `cors` (main.ts:app.enableCors),
 * и у socket.io (`cors.origin` в @WebSocketGateway) — оба пакета читают
 * опции из одного и того же npm-модуля `cors`. Не импортируем тип оттуда
 * напрямую (внутренний путь @nestjs/common/interfaces/external/... не
 * часть публичного API и может переехать между версиями) — структурная
 * типизация TS сама сматчит эту функцию в обоих местах использования.
 */
export type CorsOriginCallback = (err: Error | null, allow?: boolean) => void;

export const checkOrigin = (origin: string | undefined, cb: CorsOriginCallback): void => {
  if (!origin) return cb(null, true); // server-to-server / curl / Vercel rewrite (Origin не долетает)
  try {
    const url = new URL(origin);
    const host = url.host;
    const corsOrigins = parseCorsOriginsEnv();
    if (corsOrigins.some((o) => o === origin || o === `${url.protocol}//${host}` || o === host)) {
      return cb(null, true);
    }
    if (ALWAYS_ALLOWED_HOSTS.includes(host)) return cb(null, true);
    if (isDevAllowed(host)) return cb(null, true);
    // Поддомены grantchina.tj — домен принадлежит компании, это безопасно.
    // *.vercel.app сюда намеренно НЕ входит: это дыра (Проблема 1 аудита) —
    // любой человек бесплатно деплоит сайт на произвольный-адрес.vercel.app,
    // и с credentials:true браузер жертвы приложил бы её же cookie к
    // cross-site запросу, а этот CORS разрешил бы атакующему ПРОЧИТАТЬ ответ.
    // В проде это правило не нужно вообще (см. комментарий выше), поэтому
    // удаление wildcard-а ничего не ломает.
    if (host.endsWith('.grantchina.tj')) return cb(null, true);
    // Чужой Origin — блокируем безусловно. Никакого «если env пуст —
    // разрешаем всё», это была дыра.
    return cb(new Error(`CORS blocked for origin: ${origin}`), false);
  } catch {
    return cb(new Error('Bad Origin'), false);
  }
};
