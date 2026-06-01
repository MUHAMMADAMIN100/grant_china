import type { Request, Response, CookieOptions } from 'express';

/**
 * Имя cookie с JWT-токеном сотрудников CRM.
 * Короткое имя `gc_token` (вместо `grantchina_token`) — экономия байт
 * в каждом запросе и не раскрывает бренд в DevTools при чужом доступе.
 */
export const AUTH_COOKIE_NAME = 'gc_token';

/**
 * То же для студенческого JWT (отдельный secret в backend).
 */
export const STUDENT_COOKIE_NAME = 'gc_student_token';

/**
 * Определяет httpOnly cookie-настройки исходя из протокола конкретного
 * запроса:
 *  - запрос по HTTPS (или через прокси с X-Forwarded-Proto=https) →
 *    SameSite=None + Secure (cross-origin Vercel↔Railway работает)
 *  - запрос по plain HTTP (localhost dev) →
 *    SameSite=Lax + Secure=false (браузер примет cookie без TLS)
 *
 * Любой режим можно явно переопределить env-переменной COOKIE_SAMESITE
 * (`lax` | `strict` | `none`).
 *
 * Не полагаемся на NODE_ENV: Railway его не выставляет автоматически.
 */
export function buildAuthCookieOptions(req?: Request): CookieOptions {
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || '').toLowerCase();

  // Express уважает trust proxy → req.secure читает X-Forwarded-Proto.
  // Если req не передан (например в clearCookie без контекста), считаем
  // что мы на проде https — это покрывает 99% случаев.
  const isHttps = req ? req.secure || req.protocol === 'https' : true;

  let sameSite: CookieOptions['sameSite'];
  if (sameSiteEnv === 'none' || sameSiteEnv === 'strict' || sameSiteEnv === 'lax') {
    sameSite = sameSiteEnv;
  } else {
    // HTTPS-запросы (Vercel/Railway) → cross-origin требует None.
    // HTTP-запросы (localhost dev) → Lax, иначе браузер cookie не примет
    // с Secure=true без TLS.
    sameSite = isHttps ? 'none' : 'lax';
  }
  // SameSite=None обязательно требует Secure (политика всех браузеров).
  const secure = sameSite === 'none' ? true : isHttps;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
  };
}

export function setAuthCookie(res: Response, token: string, req?: Request) {
  res.cookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions(req));
}

export function clearAuthCookie(res: Response, req?: Request) {
  // clearCookie должен использовать ТЕ ЖЕ path/sameSite/secure/domain,
  // иначе браузер не сматчит и не удалит.
  const opts = buildAuthCookieOptions(req);
  delete (opts as any).maxAge;
  res.clearCookie(AUTH_COOKIE_NAME, opts);
}

export function setStudentCookie(res: Response, token: string, req?: Request) {
  res.cookie(STUDENT_COOKIE_NAME, token, buildAuthCookieOptions(req));
}

export function clearStudentCookie(res: Response, req?: Request) {
  const opts = buildAuthCookieOptions(req);
  delete (opts as any).maxAge;
  res.clearCookie(STUDENT_COOKIE_NAME, opts);
}
