import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CallDirection, CallStatus, Prisma, Region, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isFounder, isPrivileged } from '../common/roles';
import { assignedToUserFilter, canAccessStudentRecord } from '../common/access';
import { normalizePhone } from '../common/phone';
import { CallWebhookDto, CreateCallDto, UpdateCallDto } from './dto/call.dto';

/** ТЗ v3 р4 — регион менеджера. Необязательный: внутренние вызовы могут
 * собирать объект не из JWT, и отсутствие трактуется как BOTH. */
export type CurrentUser = { id: string; role: Role; region?: Region };

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

/** Поля звонка, по которым считается доступ сотрудника (см. callAccess). */
interface CallAccessShape {
  userId: string | null;
  studentId: string | null;
  applicationId: string | null;
  student: { managerId: string | null; chinaManagerId: string | null } | null;
  application: { managerId: string | null; chinaManagerId: string | null } | null;
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
   * ЕДИНСТВЕННАЯ формула доступа к звонку — её зовут и findOne, и update.
   * Держать её в одном месте обязательно: копии в этих двух методах уже
   * разошлись однажды, и сотрудник ВИДЕЛ «свободный» звонок, но привязать его
   * к карточке не мог (PATCH отвечал 404) — то есть ровно тот разбор
   * неоднозначного номера, ради которого автопривязка и запрещена, был
   * невозможен.
   *
   * unlinkedOnly — доступ получен ТОЛЬКО как к «свободной записи»: звонок не
   * привязан ни к клиенту сотрудника, ни к нему самому, поэтому виден всему
   * отделу. Часть полей у такого звонка вырезается (см. strip).
   */
  private callAccess(call: CallAccessShape, user: CurrentUser): { allowed: boolean; unlinkedOnly: boolean } {
    const own =
      isPrivileged(user.role) ||
      call.userId === user.id ||
      (!!call.student && canAccessStudentRecord(call.student, user)) ||
      (!!call.application && canAccessStudentRecord(call.application, user));
    if (own) return { allowed: true, unlinkedOnly: false };
    // Звонок вообще без привязок — «свободная запись»: ровно тот же случай,
    // что canAccessStudentRecord открывает для ничейного студента. Без этой
    // ветки попап входящего звонка с НЕИЗВЕСТНОГО номера (ТЗ 6.2, самый
    // ценный сценарий — новый лид) молча не показывался: событие уходит в
    // комнату staff, а последующий GET /calls/:id отвечал EMPLOYEE 404.
    const unlinked = !call.studentId && !call.applicationId && !call.userId;
    return { allowed: unlinked, unlinkedOnly: unlinked };
  }

  /**
   * raw — сырой payload вебхука провайдера, содержит PII звонка. Отдаётся
   * ТОЛЬКО FOUNDER (не ADMIN, не EMPLOYEE) — см. callModel проекта архитектора.
   *
   * У звонка, доступного сотруднику ТОЛЬКО как «свободная запись», вырезаются
   * ещё recordingUrl и comment: непривязанность — это норма и для разговора со
   * ЗНАКОМЫМ клиентом (по семейному номеру привязка не ставится вовсе), иначе
   * запись разговора менеджера с его клиентом мог бы прослушать любой
   * сотрудник отдела. Журнал и попап от этого не страдают: им нужны phone,
   * direction, startedAt.
   */
  private strip<T extends CallAccessShape & { raw?: unknown }>(call: T, user: CurrentUser): T {
    if (isFounder(user.role)) return call;
    const { raw, ...rest } = call as any;
    if (isPrivileged(user.role) || !this.callAccess(call, user).unlinkedOnly) return rest;
    return { ...rest, recordingUrl: null, comment: null };
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
          // ТЗ v3 р4 — «свой» по профильному для региона полю, общей функцией.
          { student: { OR: assignedToUserFilter(user) as Prisma.StudentWhereInput[] } },
          { application: { OR: assignedToUserFilter(user) as Prisma.ApplicationWhereInput[] } },
          // «Свободные» карточки (ответственный ещё не назначен) — их даёт
          // canAccessStudentRecord, а значит findOne такой звонок открывает.
          // Без этих веток список и карточка расходились: менеджер видел 404
          // там, где ссылка из карточки студента работала.
          { student: { managerId: null, chinaManagerId: null } },
          { application: { managerId: null, chinaManagerId: null } },
          // Звонок с неизвестного номера вообще без привязок — он уходит в
          // комнату staff (см. ingestWebhook), поэтому и в журнале должен быть
          // виден всем сотрудникам, иначе попап ведёт на недоступную запись.
          { AND: [{ studentId: null }, { applicationId: null }, { userId: null }] },
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
    // 404, а не 403 — не быть оракулом существования id.
    if (!this.callAccess(call, user).allowed) throw new NotFoundException('Звонок не найден');
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
   *
   * ПРИВАТНЫЙ (системный) вариант — БЕЗ фильтра прав: его зовёт ingestWebhook,
   * где личности пользователя нет вовсе, и привязка звонка обязана работать
   * независимо от того, чей это клиент. Сотруднику отвечает resolveByPhoneFor.
   */
  private async resolveByPhoneRaw(phone: string) {
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
    // Fallback подчиняется тому же правилу однозначности, что и прямой поиск:
    // берём студента, только если ВСЕ найденные заявки указывают на одного и
    // того же. Семейный номер на двух детей давал две заявки с разными
    // studentId, и «первая по createdAt» подшивала разговор в карточку не того
    // ребёнка. Аналогично при students.length > 1: эта ситуация уже объявлена
    // неразрешимой выше, достраивать связь в обход неё нельзя — оба случая
    // уходят в candidates, где выбирает человек.
    //
    // Заявка БЕЗ studentId — это тоже отдельный человек, а не «пустая» строка:
    // на семейном номере старший ребёнок уже заведён студентом, младший пока
    // лид. Отбрасывать такие заявки перед проверкой однозначности значило бы
    // считать номер однозначным и подшивать звонок младшего в карточку
    // старшего — ровно тот дефект, который правило и должно предотвращать.
    const applicationStudentIds = applications.map((a) => a.studentId);
    const viaApplication =
      applicationStudentIds.length > 0 && applicationStudentIds.every((id) => id && id === applicationStudentIds[0])
        ? applicationStudentIds[0]
        : null;
    let student = students.length === 1 ? students[0] : null;
    if (students.length === 0 && viaApplication) {
      student = await this.prisma.student.findFirst({
        where: { id: viaApplication, deletedAt: null },
        select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
      });
    }

    return {
      normalized,
      student,
      application: applications.length === 1 ? applications[0] : null,
      // Кандидаты несут managerId/chinaManagerId — они нужны публичному
      // варианту, чтобы отфильтровать чужие карточки; наружу поля не уходят.
      candidates: [
        ...students.map((s) => ({
          kind: 'student' as const,
          id: s.id,
          fullName: s.fullName,
          managerId: s.managerId,
          chinaManagerId: s.chinaManagerId,
        })),
        ...applications.map((a) => ({
          kind: 'application' as const,
          id: a.id,
          fullName: a.fullName,
          managerId: a.managerId,
          chinaManagerId: a.chinaManagerId,
        })),
      ],
    };
  }

  /**
   * Публичный вариант «кто звонит» — для сотрудника.
   *
   * Недоступные записи не просто скрываются из полей student/application, а
   * вычищаются целиком (включая candidates): по правилам проекта чужая запись
   * для сотрудника не существует, GET /students/:id на неё отвечает 404. Без
   * фильтра эндпоинт работал и как оракул существования номера, и как выгрузка
   * ФИО + id всей чужой клиентской базы перебором номеров.
   */
  async resolveByPhoneFor(phone: string, user: CurrentUser) {
    const resolved = await this.resolveByPhoneRaw(phone);
    return {
      normalized: resolved.normalized,
      student: resolved.student && canAccessStudentRecord(resolved.student, user) ? resolved.student : null,
      application:
        resolved.application && canAccessStudentRecord(resolved.application, user) ? resolved.application : null,
      candidates: resolved.candidates
        .filter((c) => canAccessStudentRecord(c, user))
        .map((c) => ({ kind: c.kind, id: c.id, fullName: c.fullName })),
    };
  }

  // ------------------------------------------------------------------
  // ТЗ 6.2 — ручная фиксация звонка сотрудником
  // ------------------------------------------------------------------

  /** Проверяет, что сотрудник имеет доступ к карточке, к которой привязывает звонок (IDOR). */
  private async assertLinkAccess(
    dto: { studentId?: string; applicationId?: string; consultationId?: string },
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
    // У Consultation своя модель владения (managerId ИЛИ createdById,
    // chinaManagerId там нет) — формула повторяет consultations.service.ts.
    // Без этой ветки чужой consultationId проходил насквозь, а CALL_INCLUDE
    // возвращал fullName консультации в ответе — та же утечка ПД, что и IDOR
    // по студенту.
    if (dto.consultationId) {
      const consultation = await this.prisma.consultation.findFirst({
        where: { id: dto.consultationId, deletedAt: null },
        select: { id: true, fullName: true, managerId: true, createdById: true },
      });
      const allowed =
        consultation &&
        (isPrivileged(user.role) || consultation.managerId === user.id || consultation.createdById === user.id);
      if (!allowed) throw new NotFoundException('Консультация не найдена');
      studentName = studentName ?? consultation.fullName;
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
    // Та же формула, что в findOne: звонок, который сотруднику ВИДЕН как
    // «свободная запись», он обязан иметь возможность привязать к карточке —
    // это и есть ручной разбор неоднозначного (семейного) номера, ради
    // которого вебхук такую привязку не ставит. IDOR не открывается: саму
    // привязку валидирует assertLinkAccess ниже, привязать можно только к
    // доступной сотруднику карточке.
    if (!existing || !this.callAccess(existing, user).allowed) throw new NotFoundException('Звонок не найден');

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
    // Системный путь — ищем БЕЗ фильтра прав (см. resolveByPhoneRaw).
    const resolved = await this.resolveByPhoneRaw(dto.phone);

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
    // Телеметрия разговора — единственное, что провайдер вправе уточнять при
    // повторной доставке (звонок завершился, появилась запись).
    const telemetry = {
      status: dto.status ?? CallStatus.COMPLETED,
      answeredAt: dto.answeredAt ? new Date(dto.answeredAt) : null,
      endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
      durationSec: dto.durationSec ?? 0,
      recordingUrl: dto.recordingUrl ?? null,
      raw: (dto.raw ?? {}) as Prisma.InputJsonValue,
    };

    const call = await this.prisma.call.upsert({
      where: { provider_externalId: { provider, externalId: dto.externalId } },
      create: {
        provider,
        externalId: dto.externalId,
        direction: dto.direction,
        phone: dto.phone.trim(),
        phoneNormalized: normalized,
        line: dto.line ?? null,
        startedAt,
        userId,
        studentId: resolved.student?.id ?? null,
        applicationId: resolved.application?.id ?? null,
        ...telemetry,
      },
      update: {
        ...telemetry,
        // Привязок к студенту/заявке в update НЕТ намеренно: после
        // неоднозначного номера менеджер ставит их руками через PATCH
        // /calls/:id, и повторная доставка вебхука перезаписывала ручную
        // привязку автоматической (то есть обратно в null). Решение человека
        // всегда побеждает автоопределение; недостающее достраивается ниже
        // условным updateMany, который трогает только пустые поля.
        //
        // userId, наоборот, дописываем (но не обнуляем): выставить его человек
        // не может — в UpdateCallDto такого поля нет, — а провайдер уточняет.
        // Generic-адаптер пропускает и промежуточные события, где agent ещё не
        // пришёл; без этой строки первая такая доставка навсегда оставляла бы
        // в колонке «Сотрудник» прочерк.
        ...(userId ? { userId } : {}),
      },
      select: {
        id: true,
        studentId: true,
        applicationId: true,
        phone: true,
        direction: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Первая ли это доставка. Признак вычисляет САМА БД в момент записи:
    // отдельный SELECT перед upsert проигрывал перекрывающемуся ретраю АТС
    // (оба обработчика видели «записи нет»), и в журнале появлялись две строки
    // CALL_LOGGED, а у менеджера — второй попап «вам звонят».
    const firstDelivery = call.createdAt.getTime() === call.updatedAt.getTime();

    // Достраиваем привязку, если карточка клиента завелась МЕЖДУ доставками
    // (заявку оформили, пока шёл разговор). Условие «сейчас null» в where —
    // чтобы не перетереть ручной выбор менеджера, и оно же делает дозапись
    // атомарной относительно параллельного PATCH /calls/:id.
    const fillStudentId = !firstDelivery && resolved.student && !call.studentId ? resolved.student.id : null;
    const fillApplicationId =
      !firstDelivery && resolved.application && !call.applicationId ? resolved.application.id : null;
    let studentId = call.studentId;
    let applicationId = call.applicationId;
    if (fillStudentId || fillApplicationId) {
      const filled = await this.prisma.call.updateMany({
        where: {
          id: call.id,
          ...(fillStudentId ? { studentId: null } : {}),
          ...(fillApplicationId ? { applicationId: null } : {}),
        },
        data: {
          ...(fillStudentId ? { studentId: fillStudentId } : {}),
          ...(fillApplicationId ? { applicationId: fillApplicationId } : {}),
        },
      });
      if (filled.count === 1) {
        studentId = fillStudentId ?? studentId;
        applicationId = fillApplicationId ?? applicationId;
      }
    }

    if (firstDelivery) {
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
    }

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

    // Только на ПЕРВОЙ доставке: повтор вебхука приходит уже после разговора,
    // и всплывающая карточка «вам звонят» в этот момент — ложная тревога.
    if (firstDelivery && dto.direction === CallDirection.INBOUND) {
      this.realtime.emitForStudent(scope, 'call:incoming', { callId: call.id, studentId, applicationId });
    }

    // Отдельное событие на обновление истории: 'call:incoming' поднимает
    // всплывающую карточку и уходит только на входящие, а блок «Звонки» в
    // карточке студента должен обновляться и после исходящего разговора.
    this.realtime.emitForStudent(scope, 'call:logged', { id: call.id, studentId, applicationId });

    return { ok: true, callId: call.id, linked: Boolean(studentId || applicationId) };
  }
}
