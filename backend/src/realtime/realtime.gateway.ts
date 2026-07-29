import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SessionResolverService } from '../auth/session-resolver.service';
import { AUTH_COOKIE_NAME, STUDENT_COOKIE_NAME } from '../auth/cookie-helpers';
import { onUserCacheInvalidated } from '../auth/jwt.strategy';
import { onStudentCacheInvalidated } from '../student-auth/student-jwt.guard';
import { isPrivileged } from '../common/roles';
import { checkOrigin } from '../common/cors';

/** Парсит cookie-заголовок в объект { name: value }. */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}

/** Минимальные данные, нужные для маршрутизации события к «своим» сотрудникам. */
export type ManagerScope = { managerId?: string | null; chinaManagerId?: string | null };

@Injectable()
@WebSocketGateway({
  // Проблема 2 аудита волны 1: `origin: true` отражал ЛЮБОЙ Origin —
  // страница атакующего могла открыть socket.io-соединение с cookie
  // жертвы (polling-транспорт — обычный XHR с credentials) и слушать
  // весь поток staff-событий. checkOrigin — та же функция, что и у
  // HTTP CORS в main.ts (common/cors.ts): для запроса без Origin (в
  // проде сокет тоже идёт через Vercel rewrite сервер-к-серверу) — пропускаем,
  // для чужого браузерного Origin — блокируем.
  cors: {
    origin: checkOrigin,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private session: SessionResolverService) {}

  /**
   * Проблема A аудита, пункт 4: как только роль/статус пользователя
   * инвалидируются (увольнение, смена роли, soft-delete студента) — рвём
   * его текущие сокеты. Без этого уволенный сотрудник со старой (но ещё не
   * истёкшей) cookie продолжал бы получать поток событий в staff-комнатах
   * до реконнекта, то есть до 7 дней — тот же баг, что HTTP-слой закрыл в
   * Волне 0, только для WebSocket. Регистрируем слушатели в afterInit(),
   * чтобы `this.server` уже был готов на момент первого вызова.
   */
  afterInit(): void {
    onUserCacheInvalidated((userId) => this.forceDisconnectRoom(`user:${userId}`));
    onStudentCacheInvalidated((studentId) => this.forceDisconnectRoom(`student:${studentId}`));
  }

  private forceDisconnectRoom(room: string): void {
    this.server?.in(room).disconnectSockets(true);
  }

  async handleConnection(client: Socket) {
    // Извлекаем токен в порядке приоритета:
    // 1. httpOnly cookie (`gc_token` для сотрудников, `gc_student_token` для студентов)
    // 2. handshake.auth.token (legacy, передаваемый через socket.io-client)
    // 3. query string
    // 4. Authorization header
    //
    // Проблема A аудита: раньше здесь проверялась ТОЛЬКО подпись JWT, а
    // роль бралась прямо из payload — ни role, ни deletedAt не сверялись
    // с БД ни при подключении, ни потом. Уволенный сотрудник со старой
    // cookie получал поток application:new/updated, activity:new,
    // document:uploaded, notification:new ещё до 7 дней. Теперь личность
    // резолвит SessionResolverService — тот же код и тот же TTL-кэш
    // (jwt.strategy.ts/student-jwt.guard.ts), что уже используется в HTTP.
    const cookies = parseCookieHeader(
      (client.handshake.headers.cookie as string | undefined) || '',
    );
    // Легаси-путь (не cookie) — оставлен для старых клиентов, которые ещё
    // шлют токен через auth/query/Authorization. SessionResolverService
    // читает только cookie, поэтому для этого пути кладём токен в
    // «виртуальную» cookie с тем же именем, под которым его ожидает резолвер.
    const legacyToken =
      (client.handshake.auth as any)?.token ||
      (client.handshake.query as any)?.token ||
      (client.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');

    const identity = await this.session.resolve(
      legacyToken && !cookies[AUTH_COOKIE_NAME] && !cookies[STUDENT_COOKIE_NAME]
        ? { [AUTH_COOKIE_NAME]: legacyToken, [STUDENT_COOKIE_NAME]: legacyToken }
        : cookies,
    );

    if (identity.kind === 'anonymous') {
      this.logger.warn('Connection rejected: no valid session (staff or student)');
      client.disconnect(true);
      return;
    }

    if (identity.kind === 'staff') {
      (client.data as any) = { userId: identity.id, role: identity.role };
      client.join('staff');
      client.join(`user:${identity.id}`);
      if (isPrivileged(identity.role)) {
        client.join('staff:privileged');
      }
      this.logger.log(`Connected: ${identity.role} ${identity.id}`);
      return;
    }

    // identity.kind === 'student'
    (client.data as any) = { userId: identity.id, role: 'STUDENT' };
    client.join(`student:${identity.id}`);
    client.join('students');
    this.logger.log(`Connected: STUDENT ${identity.id}`);
  }

  handleDisconnect(client: Socket) {
    const data = (client.data as any) || {};
    this.logger.log(`Disconnected: ${data.role} ${data.userId}`);
  }

  /**
   * Всем сотрудникам без исключения. ТОЛЬКО для событий без привязки к
   * конкретному студенту/заявке (программы, задачи, журнал активности —
   * там GET-эндпоинт сам фильтрует видимость при перезапросе). Для
   * событий, привязанных к студенту, используй emitForStudent() —
   * иначе PII-adjacent сигнал (кто чей студент) уедет всем менеджерам
   * компании, даже после того как payload обрезан до одних id.
   */
  emitAllStaff(event: string, payload: any) {
    this.server?.to('staff').emit(event, payload);
  }

  /** Конкретному пользователю-сотруднику */
  emitUser(userId: string, event: string, payload: any) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  /** Конкретному студенту (в его ЛК) */
  emitStudent(studentId: string, event: string, payload: any) {
    this.server?.to(`student:${studentId}`).emit(event, payload);
  }

  /** Всем подключённым студентам сразу (для каталога программ и т.п.) */
  emitAllStudents(event: string, payload: any) {
    this.server?.to('students').emit(event, payload);
  }

  /**
   * Событие, привязанное к конкретному студенту/заявке. Адресаты:
   *  - staff:privileged — FOUNDER/ADMIN видят всё всегда;
   *  - user:<managerId> и user:<chinaManagerId> — назначенные менеджеры;
   *  - если оба менеджера не назначены («свободная» запись) — общая
   *    комната staff, ту же логику видимости использует hasAccess() в
   *    students.service.ts/applications.service.ts (свободную запись
   *    может взять в работу любой сотрудник);
   *  - opts.studentId — дополнительно сам студент, в свой личный канал.
   *
   * Маршрутизация считается «в момент emit» по АКТУАЛЬНЫМ managerId/
   * chinaManagerId — переназначение менеджера не требует join/leave
   * комнат на каждое переподключение, следующее же событие само уедет
   * новому менеджеру, а старый (не видящий запись через hasAccess())
   * просто перестанет их получать.
   */
  emitForStudent(scope: ManagerScope, event: string, payload: any, opts?: { studentId?: string }) {
    const rooms = new Set<string>(['staff:privileged']);
    if (scope.managerId || scope.chinaManagerId) {
      if (scope.managerId) rooms.add(`user:${scope.managerId}`);
      if (scope.chinaManagerId) rooms.add(`user:${scope.chinaManagerId}`);
    } else {
      rooms.add('staff');
    }
    if (opts?.studentId) rooms.add(`student:${opts.studentId}`);
    this.server?.to(Array.from(rooms)).emit(event, payload);
  }
}
