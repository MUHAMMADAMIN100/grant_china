import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Region, Role } from '@prisma/client';
import { AUTH_COOKIE_NAME } from './cookie-helpers';
import { PrismaService } from '../prisma/prisma.service';

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

// БАГ 4 аудита: раньше роль бралась прямо из JWT-payload, который живёт
// 7 дней и не сверяется с БД. Понизили роль или уволили сотрудника
// (deletedAt) — он ещё неделю ходил по CRM со старыми правами. Теперь
// validate() каждый раз подгружает АКТУАЛЬНУЮ роль из БД. Чтобы не бить в
// БД на каждый HTTP-запрос, держим in-memory кэш на 30 секунд.
//
// Волна 1 аудита (Проблема A): этот же кэш (getStaffState/invalidateUserCache)
// теперь переиспользуют realtime.gateway.ts и files/uploads.controller.ts —
// не заводим по второй/третьей копии Map на каждого потребителя, иначе
// invalidateUserCache() перестанет надёжно отзывать доступ везде разом.
const ROLE_CACHE_TTL_MS = 30_000;

export interface CachedUserState {
  role: Role;
  // ТЗ v3 раздел 4 — регион менеджера. Живёт ЗДЕСЬ, а не в JWT-payload, по той
  // же причине, что и роль: payload действует 7 дней и не сверяется с БД, а
  // смена региона обязана применяться сразу (иначе менеджер неделю видел бы
  // студентов чужой страны). invalidateUserCache() уже вызывается при
  // обновлении сотрудника, так что отдельного механизма не нужно.
  region: Region;
  deletedAt: Date | null;
  ts: number;
}

const userStateCache = new Map<string, CachedUserState>();

type InvalidationListener = (userId: string) => void;
const invalidationListeners: InvalidationListener[] = [];

/**
 * Регистрирует слушателя инвалидации (используется realtime.gateway.ts,
 * чтобы принудительно отключить сокеты уволенного/перепрофилированного
 * сотрудника — Проблема A аудита, пункт 4).
 */
export function onUserCacheInvalidated(fn: InvalidationListener): void {
  invalidationListeners.push(fn);
}

/**
 * Сбрасывает кэш роли/статуса пользователя. Нужно звать сразу после того,
 * как роль или deletedAt поменялись в БД (users.service.ts: update() при
 * смене role, remove() при увольнении) — иначе до 30 секунд ещё будет
 * действовать старое значение из кэша.
 */
export function invalidateUserCache(userId: string): void {
  userStateCache.delete(userId);
  for (const fn of invalidationListeners) {
    try {
      fn(userId);
    } catch {
      // Не роняем инвалидацию кэша из-за упавшего слушателя.
    }
  }
}

/**
 * Общая точка чтения состояния сотрудника (роль + deletedAt) с TTL-кэшем.
 * Используется JwtStrategy.validate(), а также realtime.gateway.ts и
 * files/uploads.controller.ts (через SessionResolverService) — единая
 * формула, единый кэш.
 *
 * Проблема H аудита: раньше обращение к БД ничем не было обёрнуто —
 * недоступность Prisma превращала КАЖДЫЙ авторизованный HTTP-запрос в 500.
 * Теперь при ошибке БД мы деградируем МЯГКО, но только если для этого
 * пользователя уже есть валидированный (пусть и протухший по TTL) кэш —
 * тогда работаем на последних известных данных, а не рвём сессии всем
 * сотрудникам разом на время инцидента с БД. Если кэша нет вообще (первая
 * проверка токена, БД недоступна) — возвращаем null, и validate() ниже
 * ответит 401, а не 500: это безопаснее, чем поверить непроверенному payload.
 */
export async function getStaffState(prisma: PrismaService, userId: string): Promise<CachedUserState | null> {
  const now = Date.now();
  const cached = userStateCache.get(userId);
  if (cached && now - cached.ts < ROLE_CACHE_TTL_MS) {
    return cached;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, region: true, deletedAt: true },
    });
    if (!user) {
      userStateCache.delete(userId);
      return null;
    }
    const state: CachedUserState = { role: user.role, region: user.region, deletedAt: user.deletedAt, ts: now };
    userStateCache.set(userId, state);
    return state;
  } catch {
    return cached ?? null;
  }
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
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
    const state = await getStaffState(this.prisma, payload.sub);
    if (!state) {
      // Либо пользователя больше нет, либо БД недоступна и кэша не было —
      // в обоих случаях безопаснее отказать, чем довериться payload.
      throw new UnauthorizedException('Пользователь не найден');
    }

    if (state.deletedAt) {
      // Уволенный сотрудник (soft-delete) не должен продолжать ходить
      // по старому токену, даже если он ещё не истёк.
      throw new UnauthorizedException('Учётная запись отключена');
    }

    return {
      id: payload.sub,
      sub: payload.sub, // для обратной совместимости со старым кодом
      email: payload.email,
      role: state.role, // актуальная роль из БД, а не из JWT-payload
      region: state.region, // ТЗ v3 р4 — тоже из БД, по той же причине
    };
  }
}
