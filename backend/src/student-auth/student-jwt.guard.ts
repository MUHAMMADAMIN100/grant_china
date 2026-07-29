import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { StudentStatus } from '@prisma/client';
import { STUDENT_COOKIE_NAME } from '../auth/cookie-helpers';
import { PrismaService } from '../prisma/prisma.service';

// БАГ 4 аудита: студенческий токен живёт до 7 дней и не сверялся с БД —
// удалённый (soft-delete) студент мог ходить в личный кабинет всю неделю
// по старой сессии, хотя `me()` уже был закрыт проверкой deletedAt.
// Кэш на 30 секунд — чтобы не бить в БД на каждый запрос личного кабинета.
//
// Волна 1 аудита (Проблема A): этот же кэш (getStudentState/invalidateStudentCache)
// теперь переиспользуют realtime.gateway.ts и files/uploads.controller.ts.
const DELETED_CHECK_TTL_MS = 30_000;

export interface CachedStudentState {
  deletedAt: Date | null;
  status: StudentStatus;
  ts: number;
}

const studentStateCache = new Map<string, CachedStudentState>();

type InvalidationListener = (studentId: string) => void;
const invalidationListeners: InvalidationListener[] = [];

/**
 * Регистрирует слушателя инвалидации (используется realtime.gateway.ts,
 * чтобы принудительно отключить сокет удалённого студента).
 */
export function onStudentCacheInvalidated(fn: InvalidationListener): void {
  invalidationListeners.push(fn);
}

/** Сбрасывает кэш статуса студента. Нужно звать сразу после soft-delete
 *  студента (students.service.ts: remove()), иначе до 30 секунд токен
 *  ещё будет считаться живым. */
export function invalidateStudentCache(studentId: string): void {
  studentStateCache.delete(studentId);
  for (const fn of invalidationListeners) {
    try {
      fn(studentId);
    } catch {
      // Не роняем инвалидацию кэша из-за упавшего слушателя.
    }
  }
}

/**
 * Общая точка чтения состояния студента (deletedAt + status) с TTL-кэшем.
 * Используется StudentJwtGuard.canActivate(), а также realtime.gateway.ts
 * и files/uploads.controller.ts через SessionResolverService.
 *
 * Проблема H аудита: при недоступности БД деградируем на последний
 * валидный кэш, если он есть (иначе — 500 на каждый запрос ЛК студента).
 * Если кэша нет вообще — null, вызывающий код должен трактовать это как
 * «не авторизован», а не как «всё ок».
 */
export async function getStudentState(prisma: PrismaService, studentId: string): Promise<CachedStudentState | null> {
  const now = Date.now();
  const cached = studentStateCache.get(studentId);
  if (cached && now - cached.ts < DELETED_CHECK_TTL_MS) {
    return cached;
  }
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { deletedAt: true, status: true },
    });
    if (!student) {
      studentStateCache.delete(studentId);
      return null;
    }
    const state: CachedStudentState = { deletedAt: student.deletedAt, status: student.status, ts: now };
    studentStateCache.set(studentId, state);
    return state;
  } catch {
    return cached ?? null;
  }
}

/**
 * Гард для эндпоинтов студента.
 *  - Извлечение токена в порядке: httpOnly cookie `gc_student_token`
 *    (новый), затем Authorization: Bearer (legacy fallback).
 *  - Сначала верифицируется STUDENT_JWT_SECRET (отдельный секрет).
 *  - Если не подошёл — fallback на JWT_SECRET (legacy токены).
 *  - Принимает только токены с role === 'STUDENT'.
 *  - Проверяет, что студент не удалён (deletedAt) — см. БАГ 4 аудита.
 */
@Injectable()
export class StudentJwtGuard implements CanActivate {
  constructor(
    private config: ConfigService,
    private jwt: JwtService,
    private prisma: PrismaService,
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

    // БАГ 4 аудита: удалённый студент не должен ходить со старой сессией.
    const state = await getStudentState(this.prisma, payload.sub);
    if (!state) {
      throw new UnauthorizedException('Студент не найден');
    }
    if (state.deletedAt) {
      throw new UnauthorizedException('Аккаунт отключён');
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
