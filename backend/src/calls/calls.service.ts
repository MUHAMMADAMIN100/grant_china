import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CallDirection, CallStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isFounder, isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { normalizePhone } from '../common/phone';
import { CallWebhookDto, CreateCallDto, UpdateCallDto } from './dto/call.dto';

export type CurrentUser = { id: string; role: Role };

const CALL_INCLUDE = {
  user: { select: { id: true, fullName: true } },
  student: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  application: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  consultation: { select: { id: true, fullName: true } },
} as const;

export interface CallListFilters {
  studentId?: string;
  applicationId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

/**
 * ТЗ 6.3 — заготовка под IP-телефонию (волна 7). В ЭТОЙ волне только чтение:
 * записей ноль (эндпоинта создания намеренно нет — см. callModel проекта
 * архитектора), но CRUD-каркас чтения/прав нужен уже сейчас, чтобы карточка
 * студента и волна 7 могли на него опереться без переделок.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
  ) {}

  /**
   * raw — сырой payload вебхука провайдера, содержит PII звонка. Отдаётся
   * ТОЛЬКО FOUNDER (не ADMIN, не EMPLOYEE) — см. callModel проекта архитектора.
   */
  private strip<T extends { raw?: unknown }>(call: T, user: CurrentUser): T {
    if (isFounder(user.role)) return call;
    const { raw, ...rest } = call as any;
    return rest;
  }

  async list(filters: CallListFilters, user: CurrentUser) {
    const and: Prisma.CallWhereInput[] = [];
    if (filters.studentId) and.push({ studentId: filters.studentId });
    if (filters.applicationId) and.push({ applicationId: filters.applicationId });
    if (filters.userId) and.push({ userId: filters.userId });
    if (filters.from || filters.to) {
      const startedAt: Prisma.DateTimeFilter = {};
      if (filters.from) startedAt.gte = filters.from;
      if (filters.to) startedAt.lte = filters.to;
      and.push({ startedAt });
    }
    // EMPLOYEE видит только звонки на своей внутренней линии либо привязанные
    // к «своим» студентам/заявкам — та же формула, что и у остальных
    // сущностей проекта (canAccessStudentRecord), но выраженная через where,
    // а не постфильтром (звонков может быть много, в отличие от грантов).
    if (!isPrivileged(user.role)) {
      and.push({
        OR: [
          { userId: user.id },
          { student: { OR: [{ managerId: user.id }, { chinaManagerId: user.id }] } },
          { application: { OR: [{ managerId: user.id }, { chinaManagerId: user.id }] } },
        ],
      });
    }
    const where: Prisma.CallWhereInput = { deletedAt: null, ...(and.length ? { AND: and } : {}) };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.call.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: pageSize,
        include: CALL_INCLUDE,
      }),
      this.prisma.call.count({ where }),
    ]);
    return { items: items.map((c) => this.strip(c, user)), total, page, pageSize };
  }

  async findOne(id: string, user: CurrentUser) {
    const call = await this.prisma.call.findFirst({ where: { id, deletedAt: null }, include: CALL_INCLUDE });
    if (!call) throw new NotFoundException('Звонок не найден');
    const hasAccess =
      isPrivileged(user.role) ||
      call.userId === user.id ||
      (call.student && canAccessStudentRecord(call.student, user)) ||
      (call.application && canAccessStudentRecord(call.application, user));
    // 404, а не 403 — не быть оракулом существования id.
    if (!hasAccess) throw new NotFoundException('Звонок не найден');
    return this.strip(call, user);
  }

  // ------------------------------------------------------------------
  // ТЗ 6.2 — определение клиента по номеру (всплывающая карточка + привязка)
  // ------------------------------------------------------------------

  /**
   * Ищет карточку клиента по НОРМАЛИЗОВАННОМУ номеру.
   *
   * Привязка ставится ТОЛЬКО при ОДНОЗНАЧНОМ совпадении. В Таджикистане один
   * номер регулярно принадлежит семье, и автосклейка при нескольких
   * совпадениях увела бы чужую карточку не тому менеджеру — тот же довод,
   * по которому консультации никогда не связываются по телефону автоматически.
   * При двух и более совпадениях возвращаем список кандидатов: пусть человек
   * выберет сам.
   */
  async resolveByPhone(phone: string) {
    const normalized = normalizePhone(phone);
    if (!normalized) return { normalized: null, student: null, application: null, candidates: [] };

    const [students, applications] = await Promise.all([
      this.prisma.student.findMany({
        where: { deletedAt: null, phones: { has: phone } },
        select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
        take: 5,
      }),
      this.prisma.application.findMany({
        where: { deletedAt: null, phoneNormalized: normalized },
        orderBy: { createdAt: 'desc' },
        select: { id: true, fullName: true, status: true, studentId: true, managerId: true, chinaManagerId: true },
        take: 5,
      }),
    ]);

    // Поиск студента по массиву phones идёт точным сравнением строки (Prisma
    // не умеет сравнивать нормализованные значения внутри String[]), поэтому
    // при промахе достраиваем связь через заявку — у неё нормализованный ключ
    // есть, и она почти всегда указывает на того же человека.
    const viaApplication = applications.find((a) => a.studentId)?.studentId ?? null;
    let student = students.length === 1 ? students[0] : null;
    if (!student && viaApplication) {
      student = await this.prisma.student.findFirst({
        where: { id: viaApplication, deletedAt: null },
        select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
      });
    }

    return {
      normalized,
      student,
      application: applications.length === 1 ? applications[0] : null,
      candidates: [
        ...students.map((s) => ({ kind: 'student' as const, id: s.id, fullName: s.fullName })),
        ...applications.map((a) => ({ kind: 'application' as const, id: a.id, fullName: a.fullName })),
      ],
    };
  }

  // ------------------------------------------------------------------
  // ТЗ 6.2 — ручная фиксация звонка сотрудником
  // ------------------------------------------------------------------

  /** Проверяет, что сотрудник имеет доступ к карточке, к которой привязывает звонок (IDOR). */
  private async assertLinkAccess(
    dto: { studentId?: string; applicationId?: string },
    user: CurrentUser,
  ): Promise<{ studentName: string | null }> {
    let studentName: string | null = null;
    if (dto.studentId) {
      const student = await this.prisma.student.findFirst({
        where: { id: dto.studentId, deletedAt: null },
        select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
      });
      if (!student || !canAccessStudentRecord(student, user)) throw new NotFoundException('Студент не найден');
      studentName = student.fullName;
    }
    if (dto.applicationId) {
      const app = await this.prisma.application.findFirst({
        where: { id: dto.applicationId, deletedAt: null },
        select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
      });
      if (!app || !canAccessStudentRecord(app, user)) throw new NotFoundException('Заявка не найдена');
      studentName = studentName ?? app.fullName;
    }
    return { studentName };
  }

  async create(dto: CreateCallDto, user: CurrentUser) {
    const { studentName } = await this.assertLinkAccess(dto, user);

    const startedAt = dto.startedAt ? new Date(dto.startedAt) : new Date();
    const durationSec = dto.durationSec ?? 0;

    const call = await this.prisma.call.create({
      data: {
        provider: 'MANUAL',
        // externalId остаётся null: ручной звонок не приходил от провайдера, а
        // NULL'ы в составном unique-индексе Postgres между собой не конфликтуют,
        // поэтому несколько ручных звонков спокойно уживаются.
        direction: dto.direction,
        status: dto.status ?? CallStatus.COMPLETED,
        phone: dto.phone.trim(),
        phoneNormalized: normalizePhone(dto.phone),
        startedAt,
        answeredAt: durationSec > 0 ? startedAt : null,
        endedAt: new Date(startedAt.getTime() + durationSec * 1000),
        durationSec,
        userId: user.id,
        studentId: dto.studentId || null,
        applicationId: dto.applicationId || null,
        consultationId: dto.consultationId || null,
        comment: dto.comment?.trim() || null,
      },
      include: CALL_INCLUDE,
    });

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CALL_LOGGED',
        studentId: dto.studentId || null,
        studentName,
        details:
          `${dto.direction === CallDirection.OUTBOUND ? 'Исходящий' : 'Входящий'} звонок ${dto.phone.trim()}` +
          (durationSec ? `, ${Math.round(durationSec / 60)} мин` : '') +
          (dto.comment?.trim() ? `: ${dto.comment.trim().slice(0, 200)}` : ''),
      })
      .catch(() => undefined);

    this.realtime.emitForStudent(
      { managerId: user.id, chinaManagerId: null },
      'call:logged',
      { id: call.id, studentId: call.studentId, applicationId: call.applicationId },
    );

    return this.strip(call, user);
  }

  async update(id: string, dto: UpdateCallDto, user: CurrentUser) {
    const existing = await this.prisma.call.findFirst({ where: { id, deletedAt: null }, include: CALL_INCLUDE });
    const allowed =
      existing &&
      (isPrivileged(user.role) ||
        existing.userId === user.id ||
        (existing.student && canAccessStudentRecord(existing.student, user)) ||
        (existing.application && canAccessStudentRecord(existing.application, user)));
    if (!allowed) throw new NotFoundException('Звонок не найден');

    await this.assertLinkAccess(dto, user);

    const call = await this.prisma.call.update({
      where: { id },
      data: {
        ...(dto.comment !== undefined ? { comment: dto.comment?.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.studentId !== undefined ? { studentId: dto.studentId || null } : {}),
        ...(dto.applicationId !== undefined ? { applicationId: dto.applicationId || null } : {}),
      },
      include: CALL_INCLUDE,
    });
    return this.strip(call, user);
  }

  // ------------------------------------------------------------------
  // ТЗ 6.2 — приём вебхука IP-телефонии
  // ------------------------------------------------------------------

  /**
   * Записывает звонок, пришедший от АТС. Вызывается ТОЛЬКО из контроллера
   * вебхука, который уже проверил общий секрет — здесь личности пользователя
   * нет вовсе, поэтому никаких ролевых проверок: это системный путь, как
   * джобы планировщика.
   *
   * ИДЕМПОТЕНТНОСТЬ — паттерн A (UNIQUE-INSERT, см. scheduler/job.contract.ts):
   * @@unique([provider, externalId]) в схеме. Повторная доставка того же
   * вебхука (а её делают все АТС) не создаёт второй записи — upsert обновляет
   * существующую.
   */
  async ingestWebhook(provider: string, dto: CallWebhookDto) {
    const normalized = normalizePhone(dto.phone);

    // Кому принадлежит номер. Привязка только при однозначном совпадении.
    const resolved = await this.resolveByPhone(dto.phone);

    // Сотрудник на внутренней линии: провайдер отдаёт внутренний номер или
    // email. По внутреннему номеру сопоставить не с чем (у User его нет —
    // новых скалярных полей в User мы не заводим намеренно), поэтому
    // поддерживаем сопоставление по email.
    let userId: string | null = null;
    if (dto.agent && dto.agent.includes('@')) {
      const agent = await this.prisma.user.findFirst({
        where: { email: dto.agent.trim().toLowerCase(), deletedAt: null },
        select: { id: true },
      });
      userId = agent?.id ?? null;
    }

    const startedAt = dto.startedAt ? new Date(dto.startedAt) : new Date();
    const data = {
      direction: dto.direction,
      status: dto.status ?? CallStatus.COMPLETED,
      phone: dto.phone.trim(),
      phoneNormalized: normalized,
      line: dto.line ?? null,
      startedAt,
      answeredAt: dto.answeredAt ? new Date(dto.answeredAt) : null,
      endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
      durationSec: dto.durationSec ?? 0,
      recordingUrl: dto.recordingUrl ?? null,
      userId,
      studentId: resolved.student?.id ?? null,
      applicationId: resolved.application?.id ?? null,
      raw: (dto.raw ?? {}) as Prisma.InputJsonValue,
    };

    const call = await this.prisma.call.upsert({
      where: { provider_externalId: { provider, externalId: dto.externalId } },
      create: { provider, externalId: dto.externalId, ...data },
      update: data,
      select: { id: true, studentId: true, applicationId: true, phone: true, direction: true },
    });

    this.activity
      .log({
        actorId: null,
        actorName: 'IP-телефония',
        actorRole: 'SYSTEM',
        action: 'CALL_LOGGED',
        studentId: resolved.student?.id ?? null,
        studentName: resolved.student?.fullName ?? resolved.application?.fullName ?? null,
        details:
          `${dto.direction === CallDirection.OUTBOUND ? 'Исходящий' : 'Входящий'} звонок ${dto.phone.trim()}` +
          ` (${provider}, ${dto.durationSec ?? 0} сек)`,
      })
      .catch(() => undefined);

    // ТЗ 6.2 — «всплывающая карточка студента/лида при входящем вызове».
    // Событие маршрутизируется по владельцу карточки: назначенному менеджеру
    // и руководству. Если номер неизвестен, карточку показывать некому
    // персонально — уходит всем сотрудникам, чтобы кто-то взял звонок.
    // В payload только идентификаторы: имя и телефон фронт запрашивает по
    // HTTP, где права уже проверены (Проблема B аудита — PII не уезжает в сокет).
    const scope = resolved.student
      ? { managerId: resolved.student.managerId, chinaManagerId: resolved.student.chinaManagerId }
      : resolved.application
        ? { managerId: resolved.application.managerId, chinaManagerId: resolved.application.chinaManagerId }
        : { managerId: null, chinaManagerId: null };

    if (dto.direction === CallDirection.INBOUND) {
      this.realtime.emitForStudent(scope, 'call:incoming', {
        callId: call.id,
        studentId: call.studentId,
        applicationId: call.applicationId,
      });
    }

    // Отдельное событие на обновление истории: 'call:incoming' поднимает
    // всплывающую карточку и уходит только на входящие, а блок «Звонки» в
    // карточке студента должен обновляться и после исходящего разговора.
    this.realtime.emitForStudent(scope, 'call:logged', {
      id: call.id,
      studentId: call.studentId,
      applicationId: call.applicationId,
    });

    return { ok: true, callId: call.id, linked: Boolean(call.studentId || call.applicationId) };
  }
}
