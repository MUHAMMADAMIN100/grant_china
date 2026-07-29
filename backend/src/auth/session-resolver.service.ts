import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role, StudentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_COOKIE_NAME, STUDENT_COOKIE_NAME } from './cookie-helpers';
import { getStaffState } from './jwt.strategy';
import { getStudentState } from '../student-auth/student-jwt.guard';

export type StaffIdentity = { kind: 'staff'; id: string; role: Role };
export type StudentIdentity = { kind: 'student'; id: string; status: StudentStatus };
export type AnonymousIdentity = { kind: 'anonymous' };
export type SessionIdentity = StaffIdentity | StudentIdentity | AnonymousIdentity;

/**
 * «Мягкий» резолвер личности по cookie — НИКОГДА не бросает исключение.
 *
 * Нужен местам, куда должен попадать и аноним (публичные картинки программ
 * в files/uploads.controller.ts, WebSocket handshake до диагностики в
 * realtime.gateway.ts) — обычные JwtAuthGuard/StudentJwtGuard тут не
 * подходят, они кидают 401 анониму.
 *
 * Роль/deletedAt ВСЕГДА сверяются с БД через общий TTL-кэш
 * jwt.strategy.ts/student-jwt.guard.ts (getStaffState/getStudentState) —
 * так уволенный сотрудник или удалённый студент не пройдёт, даже если
 * подпись токена ещё валидна (Проблема A аудита). Кэш общий с HTTP-слоем:
 * один invalidateUserCache()/invalidateStudentCache() отзывает доступ
 * везде разом, второй Map никто не заводит.
 *
 * При ошибке БД (Проблема H аудита) — деградируем в anonymous, а не
 * бросаем исключение: getStaffState/getStudentState сами решают, отдать
 * ли последнее известное состояние из просроченного кэша или null;
 * здесь мы просто не даём случиться необработанному исключению на
 * публичном (для анонима) HTTP/WS пути.
 */
@Injectable()
export class SessionResolverService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async resolve(cookies: Record<string, string | undefined>): Promise<SessionIdentity> {
    const staffToken = cookies?.[AUTH_COOKIE_NAME];
    const studentToken = cookies?.[STUDENT_COOKIE_NAME];

    const staffSecret = this.config.get<string>('JWT_SECRET');
    const studentSecret = this.config.get<string>('STUDENT_JWT_SECRET');

    const staffIdentity = await this.tryResolveStaff(staffToken, staffSecret);
    if (staffIdentity) return staffIdentity;

    const studentIdentity = await this.tryResolveStudent(studentToken, studentSecret, staffSecret);
    if (studentIdentity) return studentIdentity;

    return { kind: 'anonymous' };
  }

  private async tryResolveStaff(token: string | undefined, secret: string | undefined): Promise<StaffIdentity | null> {
    if (!token || !secret) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: string }>(token, { secret });
      const state = await getStaffState(this.prisma, payload.sub);
      if (!state || state.deletedAt) return null;
      return { kind: 'staff', id: payload.sub, role: state.role };
    } catch {
      return null; // невалидная подпись/истёк токен — не роняем запрос
    }
  }

  private async tryResolveStudent(
    token: string | undefined,
    studentSecret: string | undefined,
    legacySecret: string | undefined,
  ): Promise<StudentIdentity | null> {
    if (!token) return null;
    let payload: { sub: string } | null = null;
    if (studentSecret) {
      try {
        payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: studentSecret });
      } catch {
        // не подошёл — пробуем legacy ниже
      }
    }
    if (!payload && legacySecret) {
      try {
        payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: legacySecret });
      } catch {
        return null;
      }
    }
    if (!payload) return null;

    const state = await getStudentState(this.prisma, payload.sub);
    if (!state || state.deletedAt) return null;
    // Архивных студентов для доступа к файлам приравниваем к анониму —
    // они уже не должны продолжать работу с личными документами.
    if (state.status === 'ARCHIVED') return null;
    return { kind: 'student', id: payload.sub, status: state.status };
  }
}
