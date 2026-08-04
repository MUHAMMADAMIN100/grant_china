import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsultationKind, ConsultationOutcome, Prisma, Role } from '@prisma/client';
import { containsInsensitive } from '../common/search';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { normalizePhone, phoneContainsConditions } from '../common/phone';
import { normalizeSource } from '../common/lead-source';
import { findRepeatOfId } from '../common/application-repeat';
import { claimFirstTouch } from '../common/lead-touch';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

export type CurrentUser = { id: string; role: Role };

const KIND_LABEL: Record<ConsultationKind, string> = {
  CONSULTATION: 'Консультация',
  INTERVIEW: 'Собеседование',
};

// include (не select) — Consultation небольшая модель, все скаляры и так
// возвращаются полностью, добавляем только лёгкие связи для UI.
const CONSULTATION_INCLUDE = {
  manager: { select: { id: true, fullName: true, email: true } },
  createdBy: { select: { id: true, fullName: true } },
  application: { select: { id: true, status: true, fullName: true } },
  student: { select: { id: true, fullName: true } },
} as const;

export interface ConsultationListFilters {
  from?: Date;
  to?: Date;
  managerId?: string;
  kind?: ConsultationKind;
  outcome?: ConsultationOutcome;
  /** ТЗ 3.1 — тот же справочник источников. 'NONE' → source: null. */
  source?: string;
  search?: string;
  applicationId?: string;
  studentId?: string;
  mine?: boolean;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class ConsultationsService {
  constructor(
    private prisma: PrismaService,
    // ТЗ 3.2 — ЕДИНСТВЕННАЯ зависимость на TasksModule. Прямой доступ к
    // prisma.task отсюда запрещён архитектурой: TasksService — граница модуля.
    private tasks: TasksService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
  ) {}

  private parseDate(raw: string, message: string): Date {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(message);
    return d;
  }

  /** Данные для TasksService.createSystemTask()/upsertSystemTask() — задача «Повторный звонок». */
  private followUpTaskInput(
    c: { id: string; fullName: string; phone: string; purpose: string; kind: ConsultationKind },
    assignedToId: string,
    dueDate: Date,
  ) {
    return {
      title: `Повторный звонок: ${c.fullName}`,
      description: `${c.phone}\nЦель обращения: ${c.purpose}\nТип: ${KIND_LABEL[c.kind]}`,
      assignedToId,
      dueDate,
      // ТЗ 3.2 — ключ идемпотентности: одна консультация = максимум одна
      // автозадача на повторный звонок, независимо от числа прогонов/переносов.
      originKey: `consultation-followup:${c.id}`,
    };
  }

  private async refetch(id: string) {
    return this.prisma.consultation.findUniqueOrThrow({ where: { id }, include: CONSULTATION_INCLUDE });
  }

  /**
   * IDOR-защита: связать консультацию можно только с заявкой, к которой есть
   * доступ (иначе 404, не 403). Возвращает саму заявку (не void) — раздел 5
   * ТЗ (волна 6) использует managerId отсюда для claimFirstTouch(), чтобы не
   * делать вторую выборку той же строки.
   */
  private async validateApplicationLink(
    applicationId: string | undefined,
    user: CurrentUser,
  ): Promise<{ id: string; managerId: string | null } | null> {
    if (!applicationId) return null;
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, deletedAt: null },
      select: { id: true, managerId: true, chinaManagerId: true },
    });
    if (!app || !canAccessStudentRecord(app, user)) {
      throw new NotFoundException('Заявка не найдена');
    }
    return app;
  }

  private async validateStudentLink(studentId: string | undefined, user: CurrentUser): Promise<void> {
    if (!studentId) return;
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, managerId: true, chinaManagerId: true },
    });
    if (!student || !canAccessStudentRecord(student, user)) {
      throw new NotFoundException('Студент не найден');
    }
  }

  /**
   * Разрешает выбрать ОТВЕТСТВЕННОГО менеджера, отличного от автора записи —
   * только FOUNDER/ADMIN (обычный сотрудник фиксирует консультацию за себя).
   * Возвращает валидный managerId (по умолчанию — автор).
   */
  private async resolveManagerId(
    requestedManagerId: string | undefined,
    fallback: string,
    user: CurrentUser,
  ): Promise<string> {
    if (requestedManagerId === undefined || requestedManagerId === fallback) return fallback;
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может назначить консультацию другому менеджеру');
    }
    if (!requestedManagerId) {
      throw new BadRequestException('managerId не может быть пустым');
    }
    const exists = await this.prisma.user.findFirst({ where: { id: requestedManagerId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Менеджер не найден');
    return requestedManagerId;
  }

  /**
   * Доступ к консультации (чтение И запись — правило одно, в отличие от
   * заявок): владелец (managerId ИЛИ createdById) либо FOUNDER/ADMIN.
   * 404, а не 403 — не быть оракулом существования id.
   */
  private async loadForMutation(id: string, user: CurrentUser) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id, deletedAt: null },
      include: CONSULTATION_INCLUDE,
    });
    if (!consultation) throw new NotFoundException('Консультация не найдена');
    const allowed =
      isPrivileged(user.role) || consultation.managerId === user.id || consultation.createdById === user.id;
    if (!allowed) throw new NotFoundException('Консультация не найдена');
    return consultation;
  }

  async findOne(id: string, user: CurrentUser) {
    return this.loadForMutation(id, user);
  }

  async findAll(filters: ConsultationListFilters, user: CurrentUser) {
    const where: Prisma.ConsultationWhereInput = { deletedAt: null };
    const and: Prisma.ConsultationWhereInput[] = [];

    // EMPLOYEE видит только свои (managerId/createdById); FOUNDER/ADMIN видят
    // всё, если только сами не запросили "Мои" (.scope-switch на странице).
    if (!isPrivileged(user.role) || filters.mine) {
      and.push({ OR: [{ managerId: user.id }, { createdById: user.id }] });
    } else if (filters.managerId) {
      and.push({ managerId: filters.managerId });
    }
    if (filters.kind) and.push({ kind: filters.kind });
    if (filters.outcome) and.push({ outcome: filters.outcome });
    if (filters.source !== undefined) and.push({ source: filters.source === 'NONE' ? null : filters.source });
    if (filters.applicationId) and.push({ applicationId: filters.applicationId });
    if (filters.studentId) and.push({ studentId: filters.studentId });
    if (filters.from || filters.to) {
      const heldAt: Prisma.DateTimeFilter = {};
      if (filters.from) heldAt.gte = filters.from;
      if (filters.to) heldAt.lte = filters.to;
      and.push({ heldAt });
    }
    if (filters.search) {
      // ТЗ v3 раздел 1 — тот же приём, что в applications.service.ts
      // (buildFilterConditions): консультация несёт собственные phone (сырой
      // ввод менеджера) и phoneNormalized (результат normalizePhone).
      //
      // Сырое поле само по себе не ищет: «+992 90 123-45-67» не совпадает с
      // «901234567» из-за пробелов и дефисов. Поэтому добавляем поиск по
      // phoneNormalized в ДВУХ формах — цифры запроса как есть (ввод без кода
      // страны и частичный ввод) и те же цифры, прогнанные через normalizePhone
      // (ввод С кодом страны: «992901234567» → «901234567», а в колонке лежит
      // именно национальный номер). Разбор — в комментарии applications.service.
      const or: Prisma.ConsultationWhereInput[] = [
        { fullName: containsInsensitive(filters.search) },
        // Оставляем как запасной путь для строк, где phoneNormalized = null
        // (номер не распознан normalizePhone — короче 7 цифр).
        { phone: containsInsensitive(filters.search) },
        // Обе формы запроса. Пустой массив при поиске по имени.
        ...phoneContainsConditions('phoneNormalized', filters.search),
      ];
      and.push({ OR: or });
    }
    if (and.length) where.AND = and;

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 10));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.consultation.findMany({
        where,
        orderBy: { heldAt: 'desc' },
        skip,
        take: pageSize,
        include: CONSULTATION_INCLUDE,
      }),
      this.prisma.consultation.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async stats(user: CurrentUser) {
    const where: Prisma.ConsultationWhereInput = isPrivileged(user.role)
      ? { deletedAt: null }
      : { deletedAt: null, OR: [{ managerId: user.id }, { createdById: user.id }] };
    const [total, consultations, interviews, pendingFollowUp] = await Promise.all([
      this.prisma.consultation.count({ where }),
      this.prisma.consultation.count({ where: { ...where, kind: 'CONSULTATION' } }),
      this.prisma.consultation.count({ where: { ...where, kind: 'INTERVIEW' } }),
      // «Ожидают решения»: назначен повторный звонок, но результат ещё не зафиксирован.
      this.prisma.consultation.count({ where: { ...where, followUpAt: { not: null }, outcome: null } }),
    ]);
    return { total, consultations, interviews, pendingFollowUp };
  }

  /**
   * ТЗ 3.2 — фиксация очной консультации/собеседования. При указанном
   * followUpAt СИНХРОННО (в этом же запросе) создаётся задача на повторный
   * звонок через TasksService.createSystemTask() — независимо от того, жив
   * ли планировщик: сама запись «нужно позвонить» не должна зависеть от крона.
   */
  async create(dto: CreateConsultationDto, user: CurrentUser) {
    const managerId = await this.resolveManagerId(dto.managerId, user.id, user);
    const linkedApplication = await this.validateApplicationLink(dto.applicationId, user);
    await this.validateStudentLink(dto.studentId, user);

    const phone = dto.phone.trim();
    const phoneNormalized = normalizePhone(phone);
    const heldAt = dto.heldAt ? this.parseDate(dto.heldAt, 'Некорректная дата проведения') : new Date();
    const followUpAt = dto.followUpAt ? this.parseDate(dto.followUpAt, 'Некорректная дата повторного звонка') : null;

    const consultation = await this.prisma.consultation.create({
      data: {
        fullName: dto.fullName.trim(),
        phone,
        phoneNormalized,
        purpose: dto.purpose.trim(),
        kind: dto.kind ?? 'CONSULTATION',
        source: normalizeSource(dto.source),
        sourceDetail: dto.sourceDetail?.trim() || null,
        direction: dto.direction ?? null,
        comment: dto.comment?.trim() || null,
        heldAt,
        managerId,
        createdById: user.id,
        applicationId: dto.applicationId || null,
        studentId: dto.studentId || null,
        followUpAt,
      },
    });

    let result = consultation;
    if (followUpAt) {
      const task = await this.tasks.createSystemTask(this.followUpTaskInput(consultation, managerId, followUpAt));
      result = await this.prisma.consultation.update({
        where: { id: consultation.id },
        data: { followUpTaskId: task.id },
      });
    }

    // Раздел 5 ТЗ (волна 6) — метрика KPI «обработанный лид» (ТЗ 5.1):
    // «привязка первой консультации к заявке» — фиксация консультации
    // сразу со ссылкой на существующую заявку считается касанием.
    if (linkedApplication) {
      await claimFirstTouch(this.prisma, linkedApplication.id, linkedApplication.managerId, user.id);
    }

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONSULTATION_CREATE',
        studentId: result.studentId,
        studentName: result.fullName,
        details: `Записана ${KIND_LABEL[result.kind].toLowerCase()}: ${result.fullName}, ${result.phone}`,
      })
      .catch(() => undefined);

    // Консультация PII-adjacent (ФИО+телефон) — маршрутизация как у заявок
    // (emitForStudent), не emitAllStaff. Несвязанная ни с кем (managerId
    // всегда проставлен — см. resolveManagerId) уходит назначенному менеджеру.
    this.realtime.emitForStudent(
      { managerId: result.managerId, chinaManagerId: null },
      'consultation:new',
      { id: result.id, studentId: result.studentId, applicationId: result.applicationId },
      result.studentId ? { studentId: result.studentId } : undefined,
    );

    return this.refetch(result.id);
  }

  async update(id: string, dto: UpdateConsultationDto, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    const managerId = await this.resolveManagerId(dto.managerId, existing.managerId ?? user.id, user);

    let linkedApplication: { id: string; managerId: string | null } | null = null;
    if (dto.applicationId !== undefined) linkedApplication = await this.validateApplicationLink(dto.applicationId || undefined, user);
    if (dto.studentId !== undefined) await this.validateStudentLink(dto.studentId || undefined, user);

    const data: Prisma.ConsultationUncheckedUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) {
      const phone = dto.phone.trim();
      data.phone = phone;
      data.phoneNormalized = normalizePhone(phone);
    }
    if (dto.purpose !== undefined) data.purpose = dto.purpose.trim();
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.source !== undefined) data.source = normalizeSource(dto.source);
    if (dto.sourceDetail !== undefined) data.sourceDetail = dto.sourceDetail?.trim() || null;
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.comment !== undefined) data.comment = dto.comment?.trim() || null;
    if (dto.heldAt !== undefined) data.heldAt = this.parseDate(dto.heldAt, 'Некорректная дата проведения');
    if (dto.outcome !== undefined) data.outcome = dto.outcome;
    if (dto.managerId !== undefined) data.managerId = managerId;
    if (dto.applicationId !== undefined) data.applicationId = dto.applicationId || null;
    if (dto.studentId !== undefined) data.studentId = dto.studentId || null;

    let followUpAtChanged = false;
    // Стартуем от ТЕКУЩЕГО срока: при смене только ответственного (без
    // dto.followUpAt) задачу всё равно надо пересадить на нового менеджера,
    // и делать это нужно по уже назначенной дате звонка.
    let nextFollowUpAt: Date | null = existing.followUpAt;
    if (dto.followUpAt !== undefined) {
      nextFollowUpAt = dto.followUpAt ? this.parseDate(dto.followUpAt, 'Некорректная дата повторного звонка') : null;
      data.followUpAt = nextFollowUpAt;
      followUpAtChanged = true;
      // Сброс отметки «напоминание отправлено» — иначе перенос звонка молча
      // ломает ключевую функцию ТЗ 3.2. FollowUpReminderJob выбирает кандидатов
      // строго по reminderSentAt: null и занимает строку НАВСЕГДА. Сценарий:
      // звонок назначен на сегодня 15:00, в 14:00 ушло напоминание, менеджер
      // перенёс звонок на завтра — по второму сроку напоминание уже никогда
      // не придёт, потому что reminderSentAt заполнен со вчера.
      // Новый срок = новое напоминание.
      data.reminderSentAt = null;
    }
    const managerChanged = dto.managerId !== undefined && managerId !== existing.managerId;

    // Исполнителя автозадачи выбираем ДО записи консультации. Увольнение
    // (soft-delete) не обнуляет managerId, а upsertSystemTask на удалённого
    // исполнителя бросает NotFoundException — консультация к этому моменту уже
    // закоммичена, задача нет, и повтор действия даёт ровно ту же ошибку.
    // Транзакцией это не закрыть: TasksService — граница модуля (prisma.task
    // отсюда недоступна) и по ходу шлёт письма/realtime, которые откатить
    // нельзя. Живого ответственного нет → задачу ведёт тот, кто правит запись.
    let taskAssigneeId = managerId;
    if (nextFollowUpAt && (followUpAtChanged || managerChanged)) {
      const alive = await this.prisma.user.findFirst({
        where: { id: taskAssigneeId, deletedAt: null },
        select: { id: true },
      });
      if (!alive) taskAssigneeId = user.id;
    }

    await this.prisma.consultation.update({ where: { id }, data });
    // Раздел 5 ТЗ (волна 6) — «привязка первой консультации к заявке» (см. create()).
    if (linkedApplication) {
      await claimFirstTouch(this.prisma, linkedApplication.id, linkedApplication.managerId, user.id);
    }
    let updated = await this.refetch(id);

    // ТЗ 3.2 + риск 9 проекта архитектора: перенос/отмена повторного звонка
    // ОБЯЗАНА держать автозадачу в консистентном состоянии — иначе менеджер
    // либо молча остаётся без напоминания, либо получает фантомную задачу
    // «позвонить» после того, как звонок уже отменён.
    // Смена ОТВЕТСТВЕННОГО — такое же основание для пересинхронизации: раньше
    // задача оставалась на прежнем сотруднике, у которого доступ к
    // консультации уже отобран, а FollowUpReminderJob слала напоминание новому
    // менеджеру — задача и напоминание расходились по разным людям, и звонок
    // не делал никто.
    if (followUpAtChanged || managerChanged) {
      const originKey = `consultation-followup:${id}`;
      if (nextFollowUpAt) {
        const task = await this.tasks.upsertSystemTask(
          this.followUpTaskInput(updated, taskAssigneeId, nextFollowUpAt),
        );
        if (updated.followUpTaskId !== task.id) {
          await this.prisma.consultation.update({ where: { id }, data: { followUpTaskId: task.id } });
          updated = await this.refetch(id);
        }
      } else if (followUpAtChanged) {
        // Гасим задачу только при ЯВНОЙ отмене звонка. Смена менеджера у
        // консультации без назначенного повторного звонка гасить нечего.
        await this.tasks.softDeleteSystemTaskIfPending(originKey);
      }
    }

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONSULTATION_UPDATE',
        studentId: updated.studentId,
        studentName: updated.fullName,
        details: 'Изменены данные консультации',
      })
      .catch(() => undefined);

    this.realtime.emitForStudent(
      { managerId: updated.managerId, chinaManagerId: null },
      'consultation:updated',
      { id: updated.id, studentId: updated.studentId, applicationId: updated.applicationId },
      updated.studentId ? { studentId: updated.studentId } : undefined,
    );

    return updated;
  }

  /**
   * Soft-delete (правило проекта №1 — никогда не удалять данные). Гасим
   * связанную системную задачу, ЕСЛИ она ещё не взята в работу (риск 10
   * проекта архитектора) — иначе у менеджера навсегда остаётся фантомное
   * напоминание позвонить в никуда.
   */
  async remove(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    await this.prisma.consultation.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.tasks.softDeleteSystemTaskIfPending(`consultation-followup:${id}`);

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONSULTATION_DELETE',
        studentId: existing.studentId,
        studentName: existing.fullName,
        details: 'Консультация удалена',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      { managerId: existing.managerId, chinaManagerId: null },
      'consultation:deleted',
      { id },
      existing.studentId ? { studentId: existing.studentId } : undefined,
    );
    return { ok: true };
  }

  /**
   * «Создать заявку из консультации». Идемпотентно: если applicationId уже
   * стоит — 409, а не вторая заявка. Гонку двух одновременных кликов
   * закрывает атомарный updateMany(applicationId: null → id): если кто-то
   * успел первым, только что созданную заявку помечаем deletedAt (правило
   * проекта — никогда не удалять физически), а не оставляем висящий дубль.
   */
  async convert(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    if (existing.applicationId) {
      throw new ConflictException('Заявка уже создана из этой консультации');
    }
    const direction = existing.direction;
    if (!direction) {
      throw new BadRequestException('У консультации не указано направление — укажите его перед созданием заявки');
    }

    const repeatOfId = await findRepeatOfId(this.prisma, existing.phoneNormalized, null);
    const application = await this.prisma.application.create({
      data: {
        fullName: existing.fullName,
        phone: existing.phone,
        direction,
        comment: existing.comment,
        status: 'NEW',
        managerId: existing.managerId,
        studentId: existing.studentId,
        source: existing.source,
        sourceDetail: existing.sourceDetail,
        phoneNormalized: existing.phoneNormalized,
        repeatOfId,
      },
    });

    const claim = await this.prisma.consultation.updateMany({
      where: { id, applicationId: null, deletedAt: null },
      data: { applicationId: application.id },
    });
    if (claim.count === 0) {
      await this.prisma.application.update({ where: { id: application.id }, data: { deletedAt: new Date() } });
      throw new ConflictException('Заявка уже создана из этой консультации');
    }

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONSULTATION_CONVERT',
        studentId: existing.studentId,
        studentName: existing.fullName,
        details: `Из консультации создана заявка: ${application.fullName}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      application,
      'application:new',
      { id: application.id, studentId: application.studentId },
      application.studentId ? { studentId: application.studentId } : undefined,
    );

    return { application, consultation: await this.refetch(id) };
  }
}
