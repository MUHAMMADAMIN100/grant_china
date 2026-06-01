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
 * - httpOnly:    JavaScript НЕ может прочитать токен → XSS не угоняет сессию.
 * - secure:      Только HTTPS в production (в dev по http тоже работает).
 * - sameSite:    'lax' — защищает от CSRF в большинстве сценариев. Если
 *                CRM и backend на разных eTLD+1 (cross-site), нужно 'none'
 *                + secure, иначе браузер cookie не пошлёт. Управляется
 *                env-переменной COOKIE_SAMESITE.
 * - path: '/'   доступен для любого запроса к backend.
 * - maxAge:     7 дней — совпадает с JWT_EXPIRES_IN.
 */
export function buildAuthCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || '').toLowerCase();
  const sameSite: CookieOptions['sameSite'] =
    sameSiteEnv === 'none' || sameSiteEnv === 'strict'
      ? sameSiteEnv
      : 'lax';
  // sameSite:'none' требует secure:true (политика браузеров),
  // поэтому в этом случае secure форсируется true даже в dev.
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
