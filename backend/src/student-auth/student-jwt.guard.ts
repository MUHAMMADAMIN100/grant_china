import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { STUDENT_COOKIE_NAME } from '../auth/cookie-helpers';

/**
 * Гард для эндпоинтов студента.
 *  - Извлечение токена в порядке: httpOnly cookie `gc_student_token`
 *    (новый), затем Authorization: Bearer (legacy fallback).
 *  - Сначала верифицируется STUDENT_JWT_SECRET (отдельный секрет).
 *  - Если не подошёл — fallback на JWT_SECRET (legacy токены).
 *  - Принимает только токены с role === 'STUDENT'.
 */
@Injectable()
export class StudentJwtGuard implements CanActivate {
  constructor(
    private config: ConfigService,
    private jwt: JwtService,
  ) {}

  private extractToken(req: any): string | null {
    // Сначала cookie (новый безопасный способ — XSS не угоняет)
    const cookieToken = req?.cookies?.[STUDENT_COOKIE_NAME];
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      return cookieToken;
    }
    // Legacy fallback: Authorization: Bearer
    const auth: string | undefined =
      req?.headers?.authorization || req?.headers?.Authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req);
    if (!token) {
      // 401 чтобы frontend interceptor редиректил на /login
      throw new UnauthorizedException('Требуется авторизация студента');
    }

    const studentSecret = this.config.get<string>('STUDENT_JWT_SECRET');
    const legacySecret = this.config.get<string>('JWT_SECRET');
    if (!legacySecret) {
      // Жёстко падаем — никаких fallback-secret. Без JWT_SECRET сервер
      // не должен принимать вообще никакие токены.
      throw new ForbiddenException('Auth not configured');
    }

    let payload: any = null;
    if (studentSecret) {
      try {
        payload = await this.jwt.verifyAsync(token, { secret: studentSecret });
      } catch {
        // не подошёл — пробуем legacy
      }
    }
    if (!payload) {
      try {
        payload = await this.jwt.verifyAsync(token, { secret: legacySecret });
      } catch {
        throw new UnauthorizedException('Неверный или просроченный токен');
      }
    }

    if (payload.role !== 'STUDENT') {
      // 403 — токен валидный, но не та роль (например staff пытается зайти
      // в студенческую зону)
      throw new ForbiddenException('Эта зона только для студентов');
    }

    req.user = {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return true;
  }
}
