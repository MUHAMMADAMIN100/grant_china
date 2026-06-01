import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AUTH_COOKIE_NAME } from './cookie-helpers';

/**
 * JWT-стратегия для сотрудников CRM (FOUNDER/ADMIN/EMPLOYEE).
 *
 * Извлечение токена в порядке приоритета:
 *  1. httpOnly cookie `gc_token` (новый безопасный способ — XSS не угоняет)
 *  2. Authorization: Bearer ...  (legacy fallback для совместимости со
 *     старыми клиентами / curl / Socket.io handshake авторизации)
 *
 * Когда все клиенты обновятся на новый поток (cookie) — fallback можно
 * убрать. Пока оставлен для плавной миграции без массового re-login.
 */
function extractFromCookie(req: Request): string | null {
  if (!req || !req.cookies) return null;
  const token = req.cookies[AUTH_COOKIE_NAME];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      // Жёстко падаем при старте если секрет не задан — никаких fallback
      // на 'fallback-secret', иначе атакующий подделает токен.
      throw new Error(
        'JWT_SECRET is not configured. Backend refuses to start without it.',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        extractFromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    return {
      id: payload.sub,
      sub: payload.sub, // для обратной совместимости со старым кодом
      email: payload.email,
      role: payload.role,
    };
  }
}
