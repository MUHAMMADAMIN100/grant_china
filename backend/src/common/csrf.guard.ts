import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { checkOrigin } from './cors';

/**
 * Защита от CSRF на мутирующих запросах.
 *
 * ЗАЧЕМ. Cookie сессии в проде ставятся с SameSite=None (наследие времён,
 * когда фронт на Vercel ходил напрямую в Railway cross-origin). CORS при
 * этом блокирует ЧТЕНИЕ ответа, но не саму отправку запроса: страница
 * атакующего может отправить cross-site форму с Content-Type
 * application/x-www-form-urlencoded — Nest её распарсит, cookie жертвы
 * уйдёт вместе с запросом, и POST /api/students выполнится.
 * Отсюда — отдельная проверка на уровне запроса, а не заголовков ответа.
 *
 * КАК. Смотрим два сигнала, в порядке надёжности:
 *  1. Sec-Fetch-Site — браузер выставляет его сам, подделать из JS нельзя
 *     (forbidden header). Значение cross-site означает запрос с чужого сайта.
 *  2. Origin — если Sec-Fetch-Site нет (старый браузер, прокси вырезал),
 *     проверяем Origin тем же списком, что и CORS.
 *
 * ПОЧЕМУ FAIL-OPEN при отсутствии обоих заголовков. Боевой трафик идёт через
 * Vercel rewrite СЕРВЕР-К-СЕРВЕРУ: браузер обращается к своему origin, Vercel
 * проксирует на Railway, и до бэкенда не доходит ни Origin, ни Sec-Fetch-Site.
 * Если бы мы блокировали запросы без этих заголовков, лёг бы весь прод.
 * Такой же безголовый запрос может послать curl — но curl не приносит чужую
 * cookie, а CSRF ровно про это: атака работает только через браузер жертвы,
 * а браузер всегда шлёт хотя бы один из двух заголовков.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  /** GET/HEAD/OPTIONS данные не меняют — их не проверяем. */
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const method = (req.method || '').toUpperCase();
    if (CsrfGuard.SAFE_METHODS.has(method)) return true;

    const fetchSite = req.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && fetchSite) {
      // same-origin и same-site — свои. none — переход по адресной строке
      // или закладке, тоже не атака.
      if (fetchSite === 'cross-site') {
        this.logger.warn(
          `CSRF: заблокирован cross-site ${method} ${req.originalUrl} (Origin: ${req.headers.origin ?? '—'})`,
        );
        throw new ForbiddenException('Межсайтовый запрос отклонён');
      }
      return true;
    }

    // Sec-Fetch-Site не пришёл — падаем на Origin.
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin) {
      let allowed = false;
      checkOrigin(origin, (_err, ok) => {
        allowed = ok === true;
      });
      if (!allowed) {
        this.logger.warn(
          `CSRF: заблокирован ${method} ${req.originalUrl} с чужого Origin: ${origin}`,
        );
        throw new ForbiddenException('Межсайтовый запрос отклонён');
      }
    }

    // Ни Sec-Fetch-Site, ни Origin — см. блок «ПОЧЕМУ FAIL-OPEN» выше.
    return true;
  }
}
