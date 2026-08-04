import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ContractStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isPrivileged, isFounder, canWriteFinance, canManageFinance } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { parseCalendarDate, formatDateRuShort } from '../grants/grant-year';
import { AMOUNT_RE } from '../payments/dto/create-payment.dto';
import { CreateContractDto } from './dto/create-contract.dto';
import { SignContractDto, TerminateContractDto, UpdateContractDto } from './dto/update-contract.dto';

export type CurrentUser = { id: string; role: Role };

const CONTRACT_INCLUDE = {
  student: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  application: { select: { id: true, fullName: true, status: true } },
  manager: { select: { id: true, fullName: true } },
  signedBy: { select: { id: true, fullName: true } },
  terminatedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ContractInclude;

type ContractRow = Prisma.ContractGetPayload<{ include: typeof CONTRACT_INCLUDE }>;

export interface ContractListFilters {
  status?: ContractStatus;
  managerId?: string;
  studentId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Раздел 5 ТЗ (волна 6) — договоры. РЕШЕНИЕ ЗАКАЗЧИКА: договор — ОТДЕЛЬНАЯ
 * СУЩНОСТЬ, не статус заявки (см. schema.prisma, комментарий к Contract).
 * Доступ считает СЕРВИС по canAccessStudentRecord — тот же приём, что в
 * grants.service.ts/consultations.service.ts (RolesGuard навешен, но без
 * @Roles на классе: видимость управляется владением студента).
 */
@Injectable()
export class ContractsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
  ) {}

  private money(v: Prisma.Decimal | number | string | null | undefined): string {
    return new Prisma.Decimal(v ?? 0).toFixed(2);
  }

  private serialize(row: ContractRow) {
    return { ...row, amount: this.money(row.amount) };
  }

  private parseAmount(raw: string | undefined): Prisma.Decimal {
    if (raw === undefined) return new Prisma.Decimal(0);
    if (!AMOUNT_RE.test(raw)) throw new BadRequestException('Некорректная сумма договора');
    const value = new Prisma.Decimal(raw);
    if (value.lessThan(0)) throw new BadRequestException('Сумма договора не может быть отрицательной');
    return value;
  }

  private studentScopeWhere(user: CurrentUser, extra: Prisma.StudentWhereInput[] = []): Prisma.StudentWhereInput {
    const and: Prisma.StudentWhereInput[] = [...extra];
    if (!isPrivileged(user.role)) {
      and.push({ OR: [{ managerId: null, chinaManagerId: null }, { managerId: user.id }, { chinaManagerId: user.id }] });
    }
    return and.length ? { deletedAt: null, AND: and } : { deletedAt: null };
  }

  /** IDOR-защита: студент должен существовать и быть доступен пользователю (создание договора). */
  private async loadStudentForLink(studentId: string, user: CurrentUser) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
    });
    if (!student || !canAccessStudentRecord(student, user)) throw new NotFoundException('Студент не найден');
    return student;
  }

  /**
   * ТЗ v3 раздел 4, критерий приёмки №4 — Администратор в финансовой части
   * только читает, а договор несёт сумму. Защита в глубину поверх @Roles на
   * контроллере.
   *
   * Вызывается из самих операций записи, а НЕ из loadForMutation(): та же
   * функция обслуживает findOne() (строка ниже по файлу), и проверка внутри
   * неё закрыла бы Администратору просмотр договоров, который ТЗ ему прямо
   * оставляет.
   */
  private assertCanWriteFinance(user: CurrentUser) {
    if (!canWriteFinance(user.role)) {
      throw new ForbiddenException(
        'Администратор работает с договорами в режиме просмотра. Оформить или изменить договор может Основатель или назначенный менеджер студента.',
      );
    }
  }

  /** Доступ к договору (чтение И запись): видимость по студенту, 404 (не 403) — не быть оракулом существования. */
  private async loadForMutation(id: string, user: CurrentUser): Promise<ContractRow> {
    const contract = await this.prisma.contract.findFirst({ where: { id, deletedAt: null }, include: CONTRACT_INCLUDE });
    if (!contract || !canAccessStudentRecord(contract.student, user)) throw new NotFoundException('Договор не найден');
    return contract;
  }

  private async refetch(id: string): Promise<ContractRow> {
    return this.prisma.contract.findUniqueOrThrow({ where: { id }, include: CONTRACT_INCLUDE });
  }

  /** 'ДГ-{год}-{счётчик}'. Ретраи на редкую гонку двух одновременных договоров в один и тот же момент. */
  private async generateNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `ДГ-${year}-`;
    const count = await this.prisma.contract.count({ where: { number: { startsWith: prefix } } });
    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }

  async findAll(filters: ContractListFilters, user: CurrentUser) {
    const and: Prisma.ContractWhereInput[] = [];
    if (filters.status) and.push({ status: filters.status });
    if (filters.studentId) and.push({ studentId: filters.studentId });
    if (filters.from || filters.to) {
      const signedAt: Prisma.DateTimeFilter = {};
      if (filters.from) signedAt.gte = filters.from;
      if (filters.to) signedAt.lte = filters.to;
      and.push({ signedAt });
    }
    if (filters.managerId) and.push({ managerId: filters.managerId });

    const studentExtra: Prisma.StudentWhereInput[] = [];
    if (filters.search) studentExtra.push({ fullName: { contains: filters.search, mode: 'insensitive' } });
    and.push({ student: this.studentScopeWhere(user, studentExtra) });

    const where: Prisma.ContractWhereInput = { deletedAt: null, AND: and };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where,
        orderBy: [{ signedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        include: CONTRACT_INCLUDE,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return { items: items.map((c) => this.serialize(c)), total, page, pageSize };
  }

  async stats(user: CurrentUser) {
    const base: Prisma.ContractWhereInput = { deletedAt: null, student: this.studentScopeWhere(user) };
    const [total, draft, signed, terminated, completed] = await Promise.all([
      this.prisma.contract.count({ where: base }),
      this.prisma.contract.count({ where: { ...base, status: 'DRAFT' } }),
      this.prisma.contract.count({ where: { ...base, status: 'SIGNED' } }),
      this.prisma.contract.count({ where: { ...base, status: 'TERMINATED' } }),
      this.prisma.contract.count({ where: { ...base, status: 'COMPLETED' } }),
    ]);
    return { total, draft, signed, terminated, completed };
  }

  async findOne(id: string, user: CurrentUser) {
    return this.serialize(await this.loadForMutation(id, user));
  }

  async create(dto: CreateContractDto, user: CurrentUser) {
    this.assertCanWriteFinance(user);
    const student = await this.loadStudentForLink(dto.studentId, user);

    let managerId: string | null = student.managerId ?? user.id;
    if (dto.managerId !== undefined) {
      if (!isPrivileged(user.role)) {
        throw new ForbiddenException('Только Основатель или администратор может назначить другого ответственного за договор');
      }
      if (dto.managerId) {
        const exists = await this.prisma.user.findFirst({ where: { id: dto.managerId, deletedAt: null }, select: { id: true } });
        if (!exists) throw new NotFoundException('Сотрудник не найден');
      }
      managerId = dto.managerId || null;
    }

    let applicationId: string | null = null;
    if (dto.applicationId) {
      const app = await this.prisma.application.findFirst({
        where: { id: dto.applicationId, deletedAt: null, studentId: dto.studentId },
        select: { id: true },
      });
      if (!app) throw new NotFoundException('Заявка не найдена или не относится к этому студенту');
      applicationId = app.id;
    }

    const amount = this.parseAmount(dto.amount);

    let contract: ContractRow | null = null;
    for (let attempt = 0; attempt < 3 && !contract; attempt++) {
      const number = await this.generateNumber();
      try {
        const created = await this.prisma.contract.create({
          data: {
            number,
            studentId: dto.studentId,
            applicationId,
            managerId,
            amount,
            note: dto.note?.trim() || null,
            createdById: user.id,
          },
          include: CONTRACT_INCLUDE,
        });
        contract = created;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 2) continue;
        throw e;
      }
    }
    if (!contract) throw new ConflictException('Не удалось сгенерировать номер договора, повторите попытку');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONTRACT_CREATE',
        studentId: student.id,
        studentName: student.fullName,
        details: `Создан договор ${contract.number} на сумму ${this.money(amount)} TJS`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(student, 'contract:updated', { id: contract.id, studentId: student.id }, { studentId: student.id });

    return this.serialize(contract);
  }

  async update(id: string, dto: UpdateContractDto, user: CurrentUser) {
    this.assertCanWriteFinance(user);
    const existing = await this.loadForMutation(id, user);
    const touchesFrozenField = dto.amount !== undefined || dto.applicationId !== undefined || dto.managerId !== undefined;
    if (existing.status !== 'DRAFT' && touchesFrozenField && !isFounder(user.role)) {
      throw new ForbiddenException('После подписания сумму, заявку и ответственного может менять только Основатель');
    }
    // Смена ответственного — привилегированное действие НЕЗАВИСИМО от статуса
    // (тот же запрет, что в create()). Раньше проверка жила только под
    // условием «договор подписан», и в черновике рядовой сотрудник переписывал
    // managerId на себя: по этому полю kpi.service.ts считает договоры и бонус,
    // администратор потом штатно подписывал договор — и деньги уходили не тому,
    // а в журнале это выглядело обычной сменой ответственного.
    if (dto.managerId !== undefined && !isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может назначить другого ответственного за договор');
    }

    const data: Prisma.ContractUpdateInput = {};
    const changes: string[] = [];

    if (dto.amount !== undefined) {
      const amount = this.parseAmount(dto.amount);
      if (!amount.equals(existing.amount)) changes.push(`Сумма: ${this.money(existing.amount)} → ${this.money(amount)} TJS`);
      data.amount = amount;
    }
    if (dto.applicationId !== undefined) {
      if (dto.applicationId) {
        const app = await this.prisma.application.findFirst({
          where: { id: dto.applicationId, deletedAt: null, studentId: existing.studentId },
          select: { id: true },
        });
        if (!app) throw new NotFoundException('Заявка не найдена или не относится к этому студенту');
        data.application = { connect: { id: dto.applicationId } };
      } else {
        data.application = { disconnect: true };
      }
      changes.push('Изменена заявка-источник');
    }
    if (dto.managerId !== undefined) {
      let newManagerName = '—';
      if (dto.managerId) {
        const newManager = await this.prisma.user.findFirst({ where: { id: dto.managerId, deletedAt: null }, select: { fullName: true } });
        if (!newManager) throw new NotFoundException('Сотрудник не найден');
        newManagerName = newManager.fullName;
        data.manager = { connect: { id: dto.managerId } };
      } else {
        data.manager = { disconnect: true };
      }
      changes.push(`Ответственный: ${existing.manager?.fullName ?? '—'} → ${newManagerName}`);
    }
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;

    const updated = await this.prisma.contract.update({ where: { id }, data, include: CONTRACT_INCLUDE });

    if (changes.length) {
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'CONTRACT_UPDATE',
          studentId: updated.studentId,
          studentName: updated.student.fullName,
          details: changes.join('; '),
        })
        .catch(() => undefined);
    }
    this.realtime.emitForStudent(updated.student, 'contract:updated', { id: updated.id, studentId: updated.studentId }, { studentId: updated.studentId });

    return this.serialize(updated);
  }

  /** ИНВАРИАНТ: status = SIGNED ⟺ signedAt IS NOT NULL ⟺ activeSlot = 'ACTIVE' — ставится одной updateMany. */
  async sign(id: string, dto: SignContractDto, user: CurrentUser) {
    // Подписание фиксирует сумму и запускает начисление бонуса менеджеру —
    // «полное управление» финансами, то есть только Основатель (ТЗ v3 р4).
    if (!canManageFinance(user.role)) {
      throw new ForbiddenException('Подписать договор может только Основатель');
    }
    const existing = await this.loadForMutation(id, user);
    if (existing.status !== 'DRAFT') throw new ConflictException('Подписать можно только черновик договора');

    let signedAt: Date;
    if (dto.signedAt) {
      try {
        signedAt = parseCalendarDate(dto.signedAt);
      } catch {
        throw new BadRequestException('Некорректная дата подписания');
      }
      if (signedAt.getTime() > Date.now()) throw new BadRequestException('Дата подписания не может быть в будущем');
      // НИЖНЯЯ ГРАНИЦА обязательна. Все метрики раздела 5 считаются по
      // signedAt, поэтому без неё договор можно «положить» в любой прошлый
      // месяц — например в тот, где до порога премии не хватало одного
      // договора, или в уже закрытый период, чтобы вызвать пересчёт.
      // Разумный люфт: договор подписали на бумаге и внесли в CRM с
      // задержкой в несколько дней — это нормальная работа. Месяцами —
      // нет. Более старую дату проставляет FOUNDER или ADMIN руками через
      // отдельный сценарий, если это действительно нужно.
      const BACKDATE_LIMIT_DAYS = 30;
      const earliest = Date.now() - BACKDATE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
      if (signedAt.getTime() < earliest) {
        throw new BadRequestException(
          `Дата подписания не может быть раньше, чем ${BACKDATE_LIMIT_DAYS} дней назад. ` +
            'Для более раннего договора обратитесь к Основателю.',
        );
      }
    } else {
      signedAt = new Date();
    }

    const result = await this.prisma.contract
      .updateMany({
        where: { id, status: 'DRAFT', deletedAt: null },
        data: { status: 'SIGNED', signedAt, signedById: user.id, activeSlot: 'ACTIVE' },
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('У студента уже есть действующий договор');
        }
        throw e;
      });
    if (result.count === 0) throw new ConflictException('Статус договора изменился, обновите страницу');

    // Раздел 5 ТЗ: подхватываем платежи и строки графика, заведённые ДО
    // подписания. Payment.contractId проставляется только в момент СОЗДАНИЯ
    // платежа (payments.service.create читает активный договор студента), а
    // штатный порядок работы обратный: сначала внесли первичную оплату,
    // потом оформили договор. Без этой привязки такие платежи молча выпадали
    // из PERCENT_OF_PAYMENTS и из метрики «своевременность сбора оплат» —
    // зарплата считалась по неполной базе, и заметить это можно было только
    // вручную сверив суммы. Кнопка «Привязать платежи» (linkPayments) для
    // этого остаётся, но теперь она нужна лишь как ручное лечение истории.
    const linked = await this.linkOrphanPayments(existing.studentId, id);

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONTRACT_SIGN',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details:
          `Договор ${existing.number} подписан ${formatDateRuShort(signedAt)}` +
          (linked.paymentsLinked || linked.scheduleLinked
            ? ` (привязано платежей: ${linked.paymentsLinked}, строк графика: ${linked.scheduleLinked})`
            : ''),
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(existing.student, 'contract:updated', { id, studentId: existing.studentId }, { studentId: existing.studentId });

    return this.serialize(await this.refetch(id));
  }

  async terminate(id: string, dto: TerminateContractDto, user: CurrentUser) {
    if (!canManageFinance(user.role)) {
      throw new ForbiddenException('Расторгнуть договор может только Основатель');
    }
    const existing = await this.loadForMutation(id, user);
    if (existing.status !== 'SIGNED') throw new ConflictException('Расторгнуть можно только подписанный договор');
    const reason = dto.reason.trim();

    const result = await this.prisma.contract.updateMany({
      where: { id, status: 'SIGNED', deletedAt: null },
      data: { status: 'TERMINATED', terminatedAt: new Date(), terminatedById: user.id, terminationReason: reason, activeSlot: null },
    });
    if (result.count === 0) throw new ConflictException('Статус договора изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONTRACT_TERMINATE',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details: `Договор ${existing.number} расторгнут: ${reason}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(existing.student, 'contract:updated', { id, studentId: existing.studentId }, { studentId: existing.studentId });

    return this.serialize(await this.refetch(id));
  }

  async complete(id: string, user: CurrentUser) {
    if (!canManageFinance(user.role)) {
      throw new ForbiddenException('Перевести договор в исполненные может только Основатель');
    }
    const existing = await this.loadForMutation(id, user);
    if (existing.status !== 'SIGNED') throw new ConflictException('Завершить можно только подписанный договор');

    const result = await this.prisma.contract.updateMany({
      where: { id, status: 'SIGNED', deletedAt: null },
      // activeSlot освобождается: инвариант «ACTIVE пока status=SIGNED» (см. schema.prisma).
      data: { status: 'COMPLETED', activeSlot: null },
    });
    if (result.count === 0) throw new ConflictException('Статус договора изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONTRACT_UPDATE',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details: `Договор ${existing.number} исполнен`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(existing.student, 'contract:updated', { id, studentId: existing.studentId }, { studentId: existing.studentId });

    return this.serialize(await this.refetch(id));
  }

  /** Soft-delete, только DRAFT (проверяется @Roles(FOUNDER) в контроллере). */
  async remove(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    if (existing.status !== 'DRAFT') throw new ConflictException('Удалить можно только черновик договора');
    await this.prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONTRACT_UPDATE',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details: `Черновик договора ${existing.number} удалён`,
      })
      .catch(() => undefined);
    return { ok: true };
  }

  /**
   * Ручная разовая привязка легаси-платежей студента (contractId=null) к
   * подписанному договору — см. contractModel проекта архитектора: «требовать
   * договор для создания платежа ЗАПРЕЩЕНО» (197 легаси-студентов), поэтому
   * приведение истории в порядок — явная кнопка, а не авто-бэкфилл.
   */
  /**
   * Привязывает «осиротевшие» платежи и строки графика студента (contractId
   * IS NULL) к указанному договору. Условие `contractId: null` делает
   * операцию идемпотентной и безопасной: график уже расторгнутого договора
   * остаётся при нём, а не переезжает на новый (безусловная перезапись
   * сломала бы историю). Вызывается автоматически из sign() и вручную из
   * linkPayments() — одна формула, два места вызова.
   */
  private async linkOrphanPayments(studentId: string, contractId: string) {
    const [paymentsResult, scheduleResult] = await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: { studentId, contractId: null, deletedAt: null },
        data: { contractId },
      }),
      this.prisma.paymentSchedule.updateMany({
        where: { studentId, contractId: null, deletedAt: null },
        data: { contractId },
      }),
    ]);
    return { paymentsLinked: paymentsResult.count, scheduleLinked: scheduleResult.count };
  }

  async linkPayments(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    if (existing.status !== 'SIGNED' && existing.status !== 'COMPLETED') {
      throw new ConflictException('Привязать платежи можно только к подписанному договору');
    }

    const linked = await this.linkOrphanPayments(existing.studentId, existing.id);
    const paymentsResult = { count: linked.paymentsLinked };
    const scheduleResult = { count: linked.scheduleLinked };

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONTRACT_UPDATE',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details: `К договору ${existing.number} привязаны платежи: ${paymentsResult.count}, строк графика: ${scheduleResult.count}`,
      })
      .catch(() => undefined);

    return { paymentsLinked: paymentsResult.count, scheduleLinked: scheduleResult.count };
  }
}
