import type { Response, CookieOptions } from 'express';

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
 * Настройки httpOnly cookie с auth-токеном.
 *
 * Логика SameSite:
 *  - В production по умолчанию `none + secure` — потому что CRM и backend
 *    почти всегда на разных eTLD+1 (Vercel + Railway), и без этого
 *    cookie не вернётся на следующий запрос (cross-site).
 *  - В dev (localhost) по умолчанию `lax` — same-origin, safer default.
 *  - Любой режим можно явно переопределить env-переменной COOKIE_SAMESITE
 *    (`lax` | `strict` | `none`).
 *
 * `secure` форсируется true когда sameSite=none (требование браузеров).
 *
 * - httpOnly: JavaScript не может прочитать → XSS не угоняет.
 * - path: '/' — отправляется на любой backend-роут.
 * - maxAge: 7 дней (совпадает с JWT_EXPIRES_IN по умолчанию).
 */
export function buildAuthCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || '').toLowerCase();

  let sameSite: CookieOptions['sameSite'];
  if (sameSiteEnv === 'none' || sameSiteEnv === 'strict' || sameSiteEnv === 'lax') {
    sameSite = sameSiteEnv;
  } else {
    // Дефолт: prod = none (cross-origin Vercel↔Railway), dev = lax (localhost)
    sameSite = isProd ? 'none' : 'lax';
  }
  // SameSite=None обязательно требует Secure (политика всех браузеров).
  const secure = sameSite === 'none' ? true : isProd;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
  };
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, buildAuthCookieOptions());
}

export function clearAuthCookie(res: Response) {
  // clearCookie должен использовать ТЕ ЖЕ path/sameSite/secure/domain,
  // иначе браузер не сматчит и не удалит.
  const opts = buildAuthCookieOptions();
  delete (opts as any).maxAge;
  res.clearCookie(AUTH_COOKIE_NAME, opts);
}

export function setStudentCookie(res: Response, token: string) {
  res.cookie(STUDENT_COOKIE_NAME, token, buildAuthCookieOptions());
}

export function clearStudentCookie(res: Response) {
  const opts = buildAuthCookieOptions();
  delete (opts as any).maxAge;
  res.clearCookie(STUDENT_COOKIE_NAME, opts);
}
