import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentKind,
  PaymentMethod,
  PaymentPurpose,
  PaymentStage,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FileResolverService } from '../files/file-resolver.service';
import { isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { localDayStart } from '../scheduler/time';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { SetScheduleDto } from './dto/set-schedule.dto';
import {
  EDITABLE_STATUSES,
  MAX_PAYMENT_AMOUNT,
  PURPOSE_LABEL,
  RECEIPT_REQUIRED_ON_CREATE_PURPOSES,
  SCHEDULE_STAGES,
  STAGE_KIND,
  STAGE_LABEL,
  STAGE_ORDER,
  assertReceiptInvariant,
  isPurposeAllowedForStage,
} from './payment-rules';

export type CurrentUser = { id: string; role: Role };

/** Лёгкий контракт файла чека — сервис не зависит от Express/Multer типов (см. students.service.addDocument). */
export interface ReceiptFileInput {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

const ACTOR_SELECT = { id: true, fullName: true } as const;

// Единый select для списков/деталей/сводки: включает receipts (чек нужен и в
// очереди на одобрение — миниатюра, и в карточке студента), и student-scope
// (managerId/chinaManagerId) — без него понадобился бы второй запрос на
// каждую проверку доступа к уже загруженному платежу.
const PAYMENT_SELECT = {
  id: true,
  studentId: true,
  student: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  contractId: true,
  stage: true,
  stageOrder: true,
  kind: true,
  purpose: true,
  method: true,
  amount: true,
  currency: true,
  paidAt: true,
  dueDate: true,
  reference: true,
  comment: true,
  status: true,
  createdById: true,
  createdBy: { select: ACTOR_SELECT },
  submittedById: true,
  submittedBy: { select: ACTOR_SELECT },
  submittedAt: true,
  approvedById: true,
  approvedBy: { select: ACTOR_SELECT },
  approvedAt: true,
  rejectedById: true,
  rejectedBy: { select: ACTOR_SELECT },
  rejectedAt: true,
  rejectionReason: true,
  voidedById: true,
  voidedBy: { select: ACTOR_SELECT },
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
  receipts: {
    where: { deletedAt: null },
    select: {
      id: true,
      filename: true,
      originalName: true,
      mimeType: true,
      size: true,
      url: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export interface PaymentListFilters {
  studentId?: string;
  status?: PaymentStatus;
  stage?: PaymentStage;
  kind?: PaymentKind;
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
  /** Игнорируется для EMPLOYEE — он всегда сужен до своих студентов. */
  managerId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private activity: ActivityService,
    private notifications: NotificationsService,
    private fileResolver: FileResolverService,
  ) {}

  // ------------------------------------------------------------------
  // Вспомогательные функции
  // ------------------------------------------------------------------

  private money(value: Prisma.Decimal | number | string | null | undefined): string {
    return new Prisma.Decimal(value ?? 0).toFixed(2);
  }

  private serialize(payment: PaymentRow) {
    return {
      ...payment,
      amount: this.money(payment.amount),
    };
  }

  private parseAmount(raw: string, opts: { allowZero?: boolean } = {}): Prisma.Decimal {
    let value: Prisma.Decimal;
    try {
      value = new Prisma.Decimal(raw);
    } catch {
      throw new BadRequestException('Некорректная сумма');
    }
    if (value.isNaN()) throw new BadRequestException('Некорректная сумма');
    // allowZero=true — для плана этапа (0 = «сумма ещё не согласована»,
    // см. PaymentSchedule.plannedAmount); для факта оплаты 0 недопустим.
    const isInvalid = opts.allowZero ? value.lessThan(0) : value.lessThanOrEqualTo(0);
    if (isInvalid) {
      throw new BadRequestException('Сумма должна быть положительным числом');
    }
    if (value.greaterThan(new Prisma.Decimal(MAX_PAYMENT_AMOUNT))) {
      throw new BadRequestException('Сумма слишком велика');
    }
    return value;
  }

  private parseDate(raw: string, message: string): Date {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(message);
    return d;
  }

  /**
   * ГРАНИЦЫ даты фактического поступления. Вынесены отдельно от разбора
   * (parseDate) намеренно: update() обязан разобрать присланную дату, но
   * проверять окно только при её РЕАЛЬНОМ изменении — см. комментарий там.
   *
   * Зачем границы вообще: по paidAt строится вся отчётность за период и база
   * премий менеджера (kpi.service считает одобренные платежи по paidAt внутри
   * расчётного месяца), поэтому свободная дата — это возможность перенести
   * поступление в нужный расчётный месяц: например в тот, где до порога премии
   * не хватало пары платежей, или в уже закрытый период, чтобы вызвать
   * пересчёт. Тот же инвариант и тот же люфт, что у Contract.signedAt
   * (contracts.service.sign).
   *
   * ОБЕ границы считаются от календарных суток по Душанбе, а не от Date.now():
   * в форме менеджер выбирает календарную дату, и она приходит как полночь.
   * Для верхней границы иначе отбивалась бы сегодняшняя дата весь день; для
   * нижней окно фактически сжималось бы до 29 суток и плавало внутри дня —
   * платёж ровно 30-дневной давности отвергался бы после 00:00 UTC+5, хотя
   * текст ошибки обещает именно 30 дней.
   */
  private assertPaidAtWithinWindow(paidAt: Date): void {
    const todayLocalStart = localDayStart(new Date()).getTime();
    const tomorrowLocalStart = todayLocalStart + 24 * 60 * 60 * 1000;
    if (paidAt.getTime() >= tomorrowLocalStart) {
      throw new BadRequestException('Дата поступления не может быть в будущем');
    }
    // Разумный люфт: деньги пришли, а внесли их в CRM с задержкой в несколько
    // дней — это нормальная работа. Месяцами — нет.
    const BACKDATE_LIMIT_DAYS = 30;
    const earliest = todayLocalStart - BACKDATE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
    if (paidAt.getTime() < earliest) {
      // Исключений по ролям здесь нет (FOUNDER получает тот же отказ) —
      // поэтому текст не обещает обходного пути, которого не существует.
      throw new BadRequestException(
        `Дата поступления не может быть раньше, чем ${BACKDATE_LIMIT_DAYS} дней назад — проверьте дату.`,
      );
    }
  }

  /** true, если у студента есть хотя бы одна НЕудалённая заявка со статусом «Зачислен» (или legacy COMPLETED). */
  private async isEnrollmentUnlocked(studentId: string): Promise<boolean> {
    const count = await this.prisma.application.count({
      where: { studentId, deletedAt: null, status: { in: ['ENROLLED', 'COMPLETED'] } },
    });
    return count > 0;
  }

  private async hasLiveReceipt(paymentId: string): Promise<boolean> {
    const count = await this.prisma.document.count({
      where: { paymentId, type: 'RECEIPT', deletedAt: null },
    });
    return count > 0;
  }

  private async getScheduleDueDate(studentId: string, stage: PaymentStage): Promise<Date | null> {
    if (STAGE_KIND[stage] !== 'SCHEDULE') return null;
    const row = await this.prisma.paymentSchedule.findFirst({
      where: { studentId, stage, deletedAt: null },
      select: { dueDate: true },
    });
    return row?.dueDate ?? null;
  }

  /**
   * Гарантирует существование строк графика (5 этапов SCHEDULE) для студента —
   * идемпотентно (upsert).
   *
   * ЗАОДНО ПРИВЯЗЫВАЕТ ГРАФИК К ДЕЙСТВУЮЩЕМУ ДОГОВОРУ. Раньше contractId
   * не проставлялся здесь вообще (в create его не было, а update: {} не
   * трогал существующие строки), и метрика «своевременность сбора оплат»
   * из ТЗ 5.1 считалась неверно: её третье слагаемое — непокрытый остаток
   * по этапам, чей срок наступил — джойнит PaymentSchedule к Contract
   * именно по contractId, то есть всегда получало пустой результат.
   * Метрика молча показывала завышенную своевременность.
   *
   * Договор появляется ПОЗЖЕ графика (график заводится при первом открытии
   * карточки, договор подписывают потом), поэтому привязку доливаем на
   * каждом вызове — а он идёт на каждый показ сводки по студенту.
   */
  private async ensureScheduleRows(studentId: string): Promise<void> {
    const activeContract = await this.prisma.contract.findFirst({
      where: { studentId, activeSlot: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    const contractId = activeContract?.id ?? null;

    await this.prisma.$transaction(
      SCHEDULE_STAGES.map((stage) =>
        this.prisma.paymentSchedule.upsert({
          where: { studentId_stage: { studentId, stage } },
          update: {},
          create: { studentId, stage, stageOrder: STAGE_ORDER[stage], contractId },
        }),
      ),
    );

    // Доливаем привязку отдельным запросом — только там, где её ещё нет.
    // upsert.update этого не умеет (условие «только если null» в нём не
    // выразить), а безусловная перезапись сломала бы историю: график
    // расторгнутого договора должен остаться при нём, а не переехать
    // на новый.
    if (contractId) {
      await this.prisma.paymentSchedule.updateMany({
        where: { studentId, contractId: null, deletedAt: null },
        data: { contractId },
      });
    }
  }

  private async loadStudentScope(studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
    });
    if (!student) throw new NotFoundException('Студент не найден');
    return student;
  }

  /**
   * GET-доступ к финансовым данным студента: если недоступен — 404
   * (не быть оракулом существования, как students.service.findOne).
   *
   * Правило СТРОЖЕ, чем canAccessStudentRecord(): та формула считает студента
   * без назначенных менеджеров доступным всем, потому что нераспределённого
   * лида любой сотрудник может взять в работу. Для карточки это разумно, для
   * денег — нет: график платежей, суммы и чеки чужого студента не должны
   * открываться просто потому, что ему пока не назначили менеджера.
   * Такие студенты остались только легаси — с волны 0.2 менеджер назначается
   * при создании, но бэкфилла не делали (данные не трогаем).
   */
  private ensureReadAccess(student: { managerId: string | null; chinaManagerId?: string | null }, user: CurrentUser, notFoundMessage: string) {
    if (isPrivileged(user.role)) return;
    const assigned = student.managerId === user.id || student.chinaManagerId === user.id;
    if (!assigned) throw new NotFoundException(notFoundMessage);
  }

  /**
   * Права на мутацию платежа (редактирование/подача/удаление/чеки): только
   * автор записи (createdById) либо ADMIN/FOUNDER. Строже, чем доступ на
   * СОЗДАНИЕ (там достаточно быть назначенным менеджером студента) —
   * поменять/удалить уже внесённые кем-то данные должен именно тот, кто их
   * внёс, иначе один менеджер сможет незаметно поправить черновик другого.
   */
  private async loadPaymentForMutation(id: string, user: CurrentUser): Promise<PaymentRow> {
    const payment = await this.prisma.payment.findFirst({ where: { id, deletedAt: null }, select: PAYMENT_SELECT });
    const allowed = payment && (isPrivileged(user.role) || payment.createdById === user.id);
    // Проблема 9 аудита волны 1: раньше «платёж не найден» (404) и «платёж
    // чужой» (403) различались кодом ответа — менеджер мог перебором id
    // подтверждать существование чужих платежей. Весь остальной проект
    // намеренно отвечает 404 в обоих случаях (см. ensureReadAccess выше,
    // students.service.findOne) — приводим к тому же поведению.
    if (!allowed) throw new NotFoundException('Платёж не найден');
    return payment;
  }

  private async refetch(id: string): Promise<PaymentRow> {
    return this.prisma.payment.findUniqueOrThrow({ where: { id }, select: PAYMENT_SELECT });
  }

  // ------------------------------------------------------------------
  // Чтение
  // ------------------------------------------------------------------

  async findAll(filters: PaymentListFilters, user: CurrentUser) {
    const where: Prisma.PaymentWhereInput = { deletedAt: null };
    const and: Prisma.PaymentWhereInput[] = [];

    if (filters.studentId) where.studentId = filters.studentId;
    if (filters.status) where.status = filters.status;
    if (filters.stage) where.stage = filters.stage;
    if (filters.kind) where.kind = filters.kind;
    if (filters.purpose) where.purpose = filters.purpose;
    if (filters.method) where.method = filters.method;
    if (filters.from || filters.to) {
      where.paidAt = {};
      if (filters.from) (where.paidAt as Prisma.DateTimeFilter).gte = filters.from;
      if (filters.to) (where.paidAt as Prisma.DateTimeFilter).lte = filters.to;
    }

    // Проблема утечки финансов (риск 3 проекта архитектора): EMPLOYEE обязан
    // видеть только платежи СВОИХ (или ещё никому не назначенных) студентов —
    // формула идентична canAccessStudentRecord(), но применена как фильтр
    // whereна уровне списка, а не как проверка одной уже загруженной записи.
    if (!isPrivileged(user.role)) {
      and.push({
        student: {
          OR: [{ managerId: user.id }, { chinaManagerId: user.id }, { managerId: null, chinaManagerId: null }],
        },
      });
    } else if (filters.managerId) {
      and.push({ student: { OR: [{ managerId: filters.managerId }, { chinaManagerId: filters.managerId }] } });
    }

    if (filters.search) {
      and.push({
        OR: [
          { reference: { contains: filters.search, mode: 'insensitive' } },
          { student: { fullName: { contains: filters.search, mode: 'insensitive' } } },
        ],
      });
    }

    if (and.length) where.AND = and;

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 10));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip,
        take: pageSize,
        select: PAYMENT_SELECT,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { items: items.map((p) => this.serialize(p)), total, page, pageSize };
  }

  /** Очередь на одобрение — только FOUNDER/ADMIN (роль проверяет RolesGuard в контроллере). */
  async findPending(filters: { page?: number; pageSize?: number }) {
    const where: Prisma.PaymentWhereInput = { status: 'PENDING_APPROVAL', deletedAt: null };
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 10));
    const skip = (page - 1) * pageSize;

    const [items, total, sumAgg] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { submittedAt: 'asc' },
        skip,
        take: pageSize,
        select: PAYMENT_SELECT,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      items: items.map((p) => this.serialize(p)),
      total,
      page,
      pageSize,
      totalAmount: this.money(sumAgg._sum.amount),
    };
  }

  async pendingCount() {
    const where: Prisma.PaymentWhereInput = { status: 'PENDING_APPROVAL', deletedAt: null };
    const [count, sumAgg] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
    ]);
    return { count, totalAmount: this.money(sumAgg._sum.amount) };
  }

  async findOne(id: string, user: CurrentUser) {
    const payment = await this.prisma.payment.findFirst({ where: { id, deletedAt: null }, select: PAYMENT_SELECT });
    if (!payment) throw new NotFoundException('Платёж не найден');
    this.ensureReadAccess(payment.student, user, 'Платёж не найден');
    return this.serialize(payment);
  }

  async getSchedule(studentId: string, user: CurrentUser) {
    if (!studentId) throw new BadRequestException('Не передан studentId');
    const student = await this.loadStudentScope(studentId);
    this.ensureReadAccess(student, user, 'Студент не найден');
    await this.ensureScheduleRows(studentId);
    const rows = await this.prisma.paymentSchedule.findMany({
      where: { studentId, deletedAt: null },
      orderBy: { stageOrder: 'asc' },
    });
    return rows.map((r) => ({ ...r, plannedAmount: this.money(r.plannedAmount) }));
  }

  /**
   * Сводка по студенту — карточка «График платежей» + «Расходы на месте».
   * Суммы (paid/pending по каждому этапу) считаются агрегацией в БД
   * (groupBy), а не суммированием в JS — иначе расхождение в отчёте при
   * росте числа платежей на этап.
   */
  async summary(studentId: string, user: CurrentUser) {
    if (!studentId) throw new BadRequestException('Не передан studentId');
    const student = await this.loadStudentScope(studentId);
    this.ensureReadAccess(student, user, 'Студент не найден');

    await this.ensureScheduleRows(studentId);

    const [scheduleRows, payments, sums, enrollmentUnlocked, activeContract] = await Promise.all([
      this.prisma.paymentSchedule.findMany({ where: { studentId, deletedAt: null }, orderBy: { stageOrder: 'asc' } }),
      this.prisma.payment.findMany({
        where: { studentId, deletedAt: null },
        orderBy: [{ stageOrder: 'asc' }, { paidAt: 'desc' }],
        select: PAYMENT_SELECT,
      }),
      this.prisma.payment.groupBy({
        by: ['stage', 'status'],
        where: { studentId, deletedAt: null, status: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
        _sum: { amount: true },
      }),
      this.isEnrollmentUnlocked(studentId),
      // Раздел 5 ТЗ (волна 6) — плашка «Договор» в карточке студента.
      this.prisma.contract.findFirst({
        where: { studentId, activeSlot: 'ACTIVE', deletedAt: null },
        select: { id: true },
      }),
    ]);

    const paidByStage = new Map<PaymentStage, Prisma.Decimal>();
    const pendingByStage = new Map<PaymentStage, Prisma.Decimal>();
    for (const row of sums) {
      const target = row.status === 'APPROVED' ? paidByStage : pendingByStage;
      target.set(row.stage, new Prisma.Decimal(row._sum.amount ?? 0));
    }

    const paymentsByStage = new Map<PaymentStage, PaymentRow[]>();
    for (const p of payments) {
      const list = paymentsByStage.get(p.stage) ?? [];
      list.push(p);
      paymentsByStage.set(p.stage, list);
    }

    // Граница «сегодня» — начало КАЛЕНДАРНЫХ СУТОК ПО ДУШАНБЕ, а не по
    // таймзоне процесса. На Railway процесс живёт в UTC, поэтому
    // `new Date().setHours(0,0,0,0)` давал полночь UTC — на пять часов
    // раньше местной, и этап считался просроченным на пять часов раньше,
    // чем видит менеджер. Весь остальной проект (планировщик, границы
    // расчётного периода, календарные даты грантов) уже считает по
    // APP_TZ_OFFSET_MINUTES — приводим к тому же правилу.
    const today = localDayStart(new Date());

    let totalPlanned = new Prisma.Decimal(0);
    let totalPaid = new Prisma.Decimal(0);
    let totalPending = new Prisma.Decimal(0);
    let totalRemaining = new Prisma.Decimal(0);
    let overdueAmount = new Prisma.Decimal(0);

    const stages = SCHEDULE_STAGES.map((stage) => {
      const sched = scheduleRows.find((r) => r.stage === stage);
      const planned = new Prisma.Decimal(sched?.plannedAmount ?? 0);
      const paid = paidByStage.get(stage) ?? new Prisma.Decimal(0);
      const pending = pendingByStage.get(stage) ?? new Prisma.Decimal(0);
      // Остаток не уходит в минус. Отрицательным он становится в ШТАТНОЙ
      // работе, а не только при переплате: строка графика заводится с
      // plannedAmount = 0 («сумма ещё не согласована»), а первичную оплату
      // вносят до согласования плана. Без клампа такой этап уменьшал остаток
      // по остальным, и карточка показывала долг меньше реального.
      // Аналитика (finance-analytics) считает ту же величину через GREATEST(...,0).
      const remaining = Prisma.Decimal.max(planned.minus(paid), 0);
      // Этап 2.1 заблокирован до зачисления — нельзя считать просроченным
      // то, что физически ещё нельзя оплатить (см. stageActivation проекта).
      const locked = stage === 'ENROLLMENT' && !enrollmentUnlocked;
      const dueDate = sched?.dueDate ?? null;
      const overdue = !locked && Boolean(dueDate) && (dueDate as Date) < today && remaining.greaterThan(0);

      totalPlanned = totalPlanned.plus(planned);
      totalPaid = totalPaid.plus(paid);
      totalPending = totalPending.plus(pending);
      totalRemaining = totalRemaining.plus(remaining);
      if (overdue) overdueAmount = overdueAmount.plus(remaining);

      return {
        stage,
        label: STAGE_LABEL[stage],
        stageOrder: STAGE_ORDER[stage],
        plannedAmount: this.money(planned),
        dueDate,
        // Комментарий строки графика возвращаем в сводку, потому что именно
        // из неё модалка «План этапа» подставляет текущие значения в форму.
        // Без него поле открывалось пустым и сохранённый комментарий стирался
        // при любом повторном сохранении плана (setSchedule).
        comment: sched?.comment ?? null,
        paidAmount: this.money(paid),
        pendingAmount: this.money(pending),
        remainingAmount: this.money(remaining),
        overdue,
        locked,
        payments: (paymentsByStage.get(stage) ?? []).map((p) => this.serialize(p)),
      };
    });

    const onSitePayments = paymentsByStage.get('LIVING_EXPENSES') ?? [];
    const onSiteByPurpose: Record<'ACCOMMODATION' | 'FOOD' | 'OTHER', Prisma.Decimal> = {
      ACCOMMODATION: new Prisma.Decimal(0),
      FOOD: new Prisma.Decimal(0),
      OTHER: new Prisma.Decimal(0),
    };
    let onSiteTotal = new Prisma.Decimal(0);
    for (const p of onSitePayments) {
      if (p.status !== 'APPROVED') continue;
      onSiteTotal = onSiteTotal.plus(p.amount);
      const key = p.purpose === 'ACCOMMODATION' || p.purpose === 'FOOD' ? p.purpose : 'OTHER';
      onSiteByPurpose[key] = onSiteByPurpose[key].plus(p.amount);
    }

    return {
      studentId,
      currency: 'TJS',
      enrollmentUnlocked,
      contractId: activeContract?.id ?? null,
      stages,
      onSite: {
        total: this.money(onSiteTotal),
        byPurpose: {
          ACCOMMODATION: this.money(onSiteByPurpose.ACCOMMODATION),
          FOOD: this.money(onSiteByPurpose.FOOD),
          OTHER: this.money(onSiteByPurpose.OTHER),
        },
        payments: onSitePayments.map((p) => this.serialize(p)),
      },
      totals: {
        planned: this.money(totalPlanned),
        paid: this.money(totalPaid),
        pending: this.money(totalPending),
        // Сумма УЖЕ склампленных остатков этапов, а не totalPlanned - totalPaid:
        // иначе переплата одного этапа снова «съедала» долг по остальным —
        // ровно то расхождение, от которого клампится remaining выше.
        // planned/paid при этом остаются фактическими, чтобы переплата была
        // видна расхождением «Оплачено» и «План».
        remaining: this.money(totalRemaining),
        overdueAmount: this.money(overdueAmount),
      },
    };
  }

  // ------------------------------------------------------------------
  // Запись — платежи
  // ------------------------------------------------------------------

  async create(dto: CreatePaymentDto, file: ReceiptFileInput | undefined, user: CurrentUser) {
    const student = await this.loadStudentScope(dto.studentId);
    if (!(isPrivileged(user.role) || canAccessStudentRecord(student, user))) {
      throw new ForbiddenException('Только назначенные менеджеры или администратор могут вносить платежи по этому студенту');
    }

    if (!isPurposeAllowedForStage(dto.stage, dto.purpose)) {
      throw new BadRequestException('Назначение платежа не соответствует выбранному этапу');
    }

    // Этап 2.1 активируется только после зачисления (stageActivation) — гейт
    // без исключений для ролей: если приказ пришёл, статус заявки должен
    // быть проставлен первым, иначе отчётность потеряет консистентность.
    if (dto.stage === 'ENROLLMENT') {
      const unlocked = await this.isEnrollmentUnlocked(dto.studentId);
      if (!unlocked) {
        throw new ConflictException('Этап 2.1 активируется после зачисления студента. Переведите заявку в статус «Зачислен»');
      }
    }

    // ТЗ 1.3: для Проживания/Питания чек обязателен уже на создании — без
    // него не создаётся НИЧЕГО (ни платёж, ни документ). Тот же инвариант,
    // что в update()/removeReceipt() — единая функция, три места вызова
    // (Проблемы 3/4 аудита волны 1).
    assertReceiptInvariant(dto.purpose, Boolean(file));

    const submit = dto.submit === 'true';
    if (submit && !file) {
      throw new BadRequestException('Прикрепите чек или квитанцию перед отправкой на одобрение');
    }

    const amount = this.parseAmount(dto.amount);
    // На СОЗДАНИИ окно проверяется всегда: новую запись задним числом заводят
    // только вручную, и подменить ею закрытый расчётный период нельзя.
    // Фолбэк new Date() в границы укладывается заведомо — проверять его незачем.
    const paidAt = dto.paidAt ? this.parseDate(dto.paidAt, 'Некорректная дата поступления') : new Date();
    if (dto.paidAt) this.assertPaidAtWithinWindow(paidAt);
    const kind = STAGE_KIND[dto.stage];
    const stageOrder = STAGE_ORDER[dto.stage];
    const dueDate = await this.getScheduleDueDate(dto.studentId, dto.stage);
    const now = new Date();

    // Раздел 5 ТЗ (волна 6): сервис САМ проставляет contractId из активного
    // договора студента, если он есть — DTO это поле НЕ принимает (клиент не
    // может подделать привязку). Требовать договор для создания платежа
    // ЗАПРЕЩЕНО (см. contractModel проекта архитектора) — 197 легаси-студентов
    // без договора продолжают вносить платежи как раньше, contractId=null.
    const activeContract = await this.prisma.contract.findFirst({
      where: { studentId: dto.studentId, activeSlot: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          studentId: dto.studentId,
          contractId: activeContract?.id ?? null,
          stage: dto.stage,
          stageOrder,
          kind,
          purpose: dto.purpose,
          method: dto.method,
          amount,
          currency: 'TJS',
          paidAt,
          dueDate,
          reference: dto.reference?.trim() || null,
          comment: dto.comment?.trim() || null,
          status: submit ? 'PENDING_APPROVAL' : 'DRAFT',
          createdById: user.id,
          submittedById: submit ? user.id : null,
          submittedAt: submit ? now : null,
        },
        select: { id: true },
      });
      if (file) {
        await tx.document.create({
          data: {
            studentId: dto.studentId,
            paymentId: payment.id,
            type: 'RECEIPT',
            filename: file.filename,
            originalName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            url: file.url,
          },
        });
      }
      return payment;
    });

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_CREATE',
        studentId: dto.studentId,
        studentName: student.fullName,
        details: `${STAGE_LABEL[dto.stage]}: ${this.money(amount)} TJS (${PURPOSE_LABEL[dto.purpose]})${submit ? ' — отправлен на одобрение' : ''}`,
      })
      .catch(() => undefined);
    // Раздел 6.3 ТЗ (волна 4): раньше чек, приложенный ПРИ СОЗДАНИИ платежа
    // (основной сценарий), не логировался отдельно вообще — PAYMENT_CREATE
    // не упоминал о нём ни словом, а «прикрепление чеков» как событие ленты
    // было невозможно отфильтровать. Второй, отдельный лог — не замена
    // PAYMENT_CREATE, а именно СОБЫТИЕ «прикреплён чек».
    if (file) {
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'PAYMENT_RECEIPT_ADD',
          studentId: dto.studentId,
          studentName: student.fullName,
          details: 'Прикреплён чек к новому платежу',
        })
        .catch(() => undefined);
    }
    this.realtime.emitForStudent(student, 'payment:created', { studentId: dto.studentId, paymentId: created.id }, { studentId: dto.studentId });

    if (submit) {
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'PAYMENT_SUBMIT',
          studentId: dto.studentId,
          studentName: student.fullName,
          details: `Платёж отправлен на одобрение: ${this.money(amount)} TJS`,
        })
        .catch(() => undefined);
      this.realtime.emitForStudent(student, 'payment:submitted', { studentId: dto.studentId, paymentId: created.id }, { studentId: dto.studentId });
      this.notifications
        .notifyFounders({
          type: 'PAYMENT_SUBMIT',
          title: 'Платёж ожидает одобрения',
          message: `${student.fullName}: новый платёж ожидает вашего подтверждения`,
          payload: { studentId: dto.studentId, paymentId: created.id },
        })
        .catch(() => undefined);
    }

    return this.serialize(await this.refetch(created.id));
  }

  async update(id: string, dto: UpdatePaymentDto, user: CurrentUser) {
    const payment = await this.loadPaymentForMutation(id, user);
    if (!EDITABLE_STATUSES.has(payment.status)) {
      throw new ConflictException('Редактировать можно только черновик или отклонённый платёж');
    }

    const nextStage = dto.stage ?? payment.stage;
    const nextPurpose = dto.purpose ?? payment.purpose;
    if (!isPurposeAllowedForStage(nextStage, nextPurpose)) {
      throw new BadRequestException('Назначение платежа не соответствует выбранному этапу');
    }
    if (dto.stage !== undefined && dto.stage !== payment.stage && dto.stage === 'ENROLLMENT') {
      const unlocked = await this.isEnrollmentUnlocked(payment.studentId);
      if (!unlocked) throw new ConflictException('Этап 2.1 активируется после зачисления студента');
    }

    // Проблема 3 аудита волны 1: create() проверяет чек только в момент
    // создания — PATCH мог сменить purpose (или stage, от которого purpose
    // косвенно зависит через isPurposeAllowedForStage выше) на «Проживание»/
    // «Питание» уже ПОСЛЕ создания, и в БД оседал сохранённый платёж без
    // единого чека. Перепроверяем итоговый (nextPurpose) инвариант здесь —
    // если чека нет, изменения не применяются вообще.
    const data: Prisma.PaymentUpdateInput = {};
    if (dto.stage !== undefined) {
      data.stage = dto.stage;
      data.stageOrder = STAGE_ORDER[dto.stage];
      data.kind = STAGE_KIND[dto.stage];
      data.dueDate = await this.getScheduleDueDate(payment.studentId, dto.stage);
    }
    if (dto.purpose !== undefined) data.purpose = dto.purpose;
    if (dto.method !== undefined) data.method = dto.method;
    if (dto.amount !== undefined) data.amount = this.parseAmount(dto.amount);
    if (dto.paidAt !== undefined) {
      const nextPaidAt = this.parseDate(dto.paidAt, 'Некорректная дата поступления');
      // Форма редактирования шлёт paidAt ВСЕГДА, даже если менеджер дату не
      // трогал (PaymentFormModal.doSaveEdit). Проверять окно бэкдейта на
      // каждой правке нельзя: отклонённый два месяца назад платёж стало бы
      // невозможно ни исправить, ни подать повторно, а единственным способом
      // его сохранить была бы подстановка ложной свежей даты — ровно то
      // искажение отчётности, от которого окно и защищает. Границы важны
      // только при РЕАЛЬНОМ переносе даты в другой расчётный период.
      if (nextPaidAt.getTime() !== payment.paidAt.getTime()) this.assertPaidAtWithinWindow(nextPaidAt);
      data.paidAt = nextPaidAt;
    }
    if (dto.reference !== undefined) data.reference = dto.reference?.trim() || null;
    if (dto.comment !== undefined) data.comment = dto.comment?.trim() || null;

    // Проблема 3 аудита волны 1: create() проверяет чек только в момент
    // создания — PATCH мог сменить purpose (или stage, от которого purpose
    // косвенно зависит через isPurposeAllowedForStage выше) на «Проживание»/
    // «Питание» уже ПОСЛЕ создания, и в БД оседал сохранённый платёж без
    // единого чека.
    //
    // Проверка и запись идут в ОДНОЙ транзакции: между ними параллельный
    // DELETE чека успевал бы проскочить, и инвариант ТЗ 1.3 нарушался бы
    // гонкой. removeReceipt() устроен симметрично — он тоже считает чеки
    // и пишет внутри транзакции, поэтому две операции сериализуются.
    const result = await this.prisma.$transaction(async (tx) => {
      if (RECEIPT_REQUIRED_ON_CREATE_PURPOSES.has(nextPurpose)) {
        const liveReceipts = await tx.document.count({
          where: { paymentId: id, type: 'RECEIPT', deletedAt: null },
        });
        assertReceiptInvariant(nextPurpose, liveReceipts > 0);
      }
      // Атомарный переход: сверяем текущий статус в WHERE, а не read-then-write —
      // иначе два одновременных редактирования одного платежа могут разъехаться.
      return tx.payment.updateMany({
        where: { id, status: payment.status, deletedAt: null },
        data,
      });
    });
    if (result.count === 0) throw new ConflictException('Статус платежа изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_UPDATE',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: 'Изменены данные платежа',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(payment.student, 'payment:updated', { studentId: payment.studentId, paymentId: id }, { studentId: payment.studentId });

    return this.serialize(await this.refetch(id));
  }

  /**
   * Кто может подать платёж на одобрение (Проблема 6 аудита волны 1, п.9):
   * автор записи, ЛИБО назначенный менеджер студента (managerId/chinaManagerId
   * — даже не автор, например коллега в отпуске, а платёж пора подавать),
   * ЛИБО ADMIN/FOUNDER. Это тот же критерий доступа, что и на СОЗДАНИЕ
   * платежа (create()) — сознательно шире, чем loadPaymentForMutation
   * (только автор), которая закрывает РЕДАКТИРОВАНИЕ уже внесённых кем-то
   * данных. «Подать» — это не правка цифр, а ручательство «я проверил и
   * прошу подтвердить», и поручиться должен вправе любой, кто отвечает за
   * студента — не только тот, кто их печатал. Это НЕ ослабляет Double Check:
   * approve() отдельно и независимо запрещает одобрять self-created/
   * self-submitted платежи (см. комментарий там).
   * Сценарий «менеджер внёс, администратор подал» продолжает работать:
   * canAccessStudentRecord() всегда true для ADMIN/FOUNDER.
   */
  private async loadPaymentForSubmit(id: string, user: CurrentUser): Promise<PaymentRow> {
    const payment = await this.prisma.payment.findFirst({ where: { id, deletedAt: null }, select: PAYMENT_SELECT });
    // Требуем ЯВНОГО назначения, а не canAccessStudentRecord(): та формула
    // считает студента без менеджеров доступным всем — это верно для
    // нераспределённых лидов, но не здесь. «Подать на одобрение» означает
    // «я ручаюсь, что деньги пришли»; поручиться за чужие цифры по студенту,
    // за которого не отвечаешь, нельзя. Студенты без менеджера остались
    // только легаси (с волны 0.2 менеджер назначается при создании).
    const isAssignedManager =
      !!payment &&
      (payment.student.managerId === user.id || payment.student.chinaManagerId === user.id);
    const allowed =
      payment && (isPrivileged(user.role) || payment.createdById === user.id || isAssignedManager);
    // 404 в обоих случаях (Проблема 9 аудита волны 1) — не быть оракулом существования.
    if (!allowed) throw new NotFoundException('Платёж не найден');
    return payment;
  }

  async submit(id: string, user: CurrentUser) {
    const payment = await this.loadPaymentForSubmit(id, user);
    if (!EDITABLE_STATUSES.has(payment.status)) {
      throw new ConflictException('Подать на одобрение можно только черновик или отклонённый платёж');
    }
    if (payment.stage === 'ENROLLMENT') {
      const unlocked = await this.isEnrollmentUnlocked(payment.studentId);
      if (!unlocked) throw new ConflictException('Этап 2.1 активируется после зачисления студента');
    }
    if (!(await this.hasLiveReceipt(id))) {
      throw new BadRequestException('Прикрепите чек или квитанцию перед отправкой на одобрение');
    }

    const now = new Date();
    const result = await this.prisma.payment.updateMany({
      where: { id, status: payment.status, deletedAt: null },
      data: { status: 'PENDING_APPROVAL', submittedById: user.id, submittedAt: now },
    });
    if (result.count === 0) throw new ConflictException('Статус платежа изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_SUBMIT',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: `Платёж отправлен на одобрение: ${this.money(payment.amount)} TJS`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(payment.student, 'payment:submitted', { studentId: payment.studentId, paymentId: id }, { studentId: payment.studentId });
    this.notifications
      .notifyFounders({
        type: 'PAYMENT_SUBMIT',
        title: 'Платёж ожидает одобрения',
        message: `${payment.student.fullName}: платёж ожидает вашего подтверждения`,
        payload: { studentId: payment.studentId, paymentId: id },
      })
      .catch(() => undefined);

    return this.serialize(await this.refetch(id));
  }

  async recall(id: string, user: CurrentUser) {
    const payment = await this.prisma.payment.findFirst({ where: { id, deletedAt: null }, select: PAYMENT_SELECT });
    if (!payment) throw new NotFoundException('Платёж не найден');
    const allowed = isPrivileged(user.role) || payment.submittedById === user.id;
    // 404, а не 403: 403 подтвердил бы существование чужого платежа. Тот же
    // приём, что в loadPaymentForMutation и students.service.findOne.
    if (!allowed) throw new NotFoundException('Платёж не найден');
    if (payment.status !== 'PENDING_APPROVAL') {
      throw new ConflictException('Отозвать можно только платёж, ожидающий одобрения');
    }

    const result = await this.prisma.payment.updateMany({
      where: { id, status: 'PENDING_APPROVAL', deletedAt: null },
      data: { status: 'DRAFT' },
    });
    if (result.count === 0) throw new ConflictException('Статус платежа изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_RECALL',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: 'Платёж отозван с одобрения',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(payment.student, 'payment:recalled', { studentId: payment.studentId, paymentId: id }, { studentId: payment.studentId });

    return this.serialize(await this.refetch(id));
  }

  /**
   * Double Check, финальный акцепт (ТЗ 1.1). Только FOUNDER (роль проверяет
   * RolesGuard в контроллере). Инвариант анти-самоподтверждения проверяет
   * ДВА поля, не одно (Проблема 6 аудита волны 1):
   *  - submittedById !== user.id — нельзя одобрить то, что сам же подал;
   *  - createdById !== user.id — нельзя одобрить то, что сам же завёл.
   * Раньше проверялось только submittedById, и обход выглядел так: Основатель
   * заводит платёж (DRAFT) на любую сумму, ЛЮБОЙ администратор нажимает
   * «Подтвердить» (submit() пускает назначенного менеджера/администратора —
   * см. loadPaymentForSubmit), после чего тот же Основатель одобряет
   * СВОЙ ЖЕ платёж. Смысл ТЗ 1.1 — «Основатель ПРОВЕРЯЕТ фактическое
   * поступление денежных средств», т.е. чужую работу, а не свою: кто бы ни
   * подал платёж, Основатель, лично внёсший данные, не может быть тем, кто
   * их же и акцептует.
   */
  async approve(id: string, updatedAtCheck: string | undefined, user: CurrentUser) {
    const payment = await this.prisma.payment.findFirst({ where: { id, deletedAt: null }, select: PAYMENT_SELECT });
    if (!payment) throw new NotFoundException('Платёж не найден');
    if (payment.status !== 'PENDING_APPROVAL') {
      throw new ConflictException('Одобрить можно только платёж, ожидающий одобрения');
    }
    if (payment.createdById && payment.createdById === user.id) {
      throw new ConflictException(
        'Нельзя одобрить платёж, который вы сами внесли в систему. Основатель проверяет чужую работу — попросите завести платёж другого сотрудника.',
      );
    }
    if (payment.submittedById && payment.submittedById === user.id) {
      throw new ConflictException(
        'Нельзя одобрить платёж, который вы сами подали на одобрение. Пусть данные внесёт и подаст менеджер — так работает двухстороннее подтверждение.',
      );
    }
    if (!(await this.hasLiveReceipt(id))) {
      throw new BadRequestException('У платежа нет подтверждающего чека — одобрение невозможно');
    }
    if (updatedAtCheck && new Date(updatedAtCheck).getTime() !== payment.updatedAt.getTime()) {
      throw new ConflictException('Платёж изменился с момента открытия карточки, обновите страницу');
    }

    const now = new Date();
    const result = await this.prisma.payment.updateMany({
      where: { id, status: 'PENDING_APPROVAL', deletedAt: null },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: now },
    });
    if (result.count === 0) throw new ConflictException('Статус платежа изменился, обновите страницу');

    // Раздел 5 ТЗ (волна 6) — веха «ПЕРЕЕЗД» (Contract.relocatedAt, метрика
    // ТЗ 5.1). Деньги за переезд — доказательство переезда. Claim-апдейт
    // (WHERE relocatedAt: null) — ставится один раз, необратимо: последующий
    // VOID этого платежа её НЕ обнуляет (см. schema.prisma, комментарий к полю).
    if (payment.stage === 'RELOCATION' && payment.contractId) {
      await this.prisma.contract.updateMany({
        where: { id: payment.contractId, relocatedAt: null },
        data: { relocatedAt: now },
      });
    }

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_APPROVE',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: `Платёж одобрен: ${this.money(payment.amount)} TJS`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(payment.student, 'payment:approved', { studentId: payment.studentId, paymentId: id }, { studentId: payment.studentId });
    if (payment.submittedById) {
      this.notifications
        .notifyUser(payment.submittedById, {
          type: 'PAYMENT_APPROVE',
          title: 'Платёж одобрен',
          message: `${payment.student.fullName}: платёж на сумму ${this.money(payment.amount)} сомони одобрен Основателем`,
          payload: { studentId: payment.studentId, paymentId: id },
        })
        .catch(() => undefined);
    }

    return this.serialize(await this.refetch(id));
  }

  async reject(id: string, reason: string, user: CurrentUser) {
    const payment = await this.prisma.payment.findFirst({ where: { id, deletedAt: null }, select: PAYMENT_SELECT });
    if (!payment) throw new NotFoundException('Платёж не найден');
    if (payment.status !== 'PENDING_APPROVAL') {
      throw new ConflictException('Отклонить можно только платёж, ожидающий одобрения');
    }

    const trimmedReason = reason.trim();
    const now = new Date();
    const result = await this.prisma.payment.updateMany({
      where: { id, status: 'PENDING_APPROVAL', deletedAt: null },
      data: { status: 'REJECTED', rejectedById: user.id, rejectedAt: now, rejectionReason: trimmedReason },
    });
    if (result.count === 0) throw new ConflictException('Статус платежа изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_REJECT',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: `Отклонено: ${trimmedReason}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(payment.student, 'payment:rejected', { studentId: payment.studentId, paymentId: id }, { studentId: payment.studentId });
    if (payment.submittedById) {
      this.notifications
        .notifyUser(payment.submittedById, {
          type: 'PAYMENT_REJECT',
          title: 'Платёж отклонён',
          message: `${payment.student.fullName}: платёж отклонён Основателем. Причина: ${trimmedReason}`,
          payload: { studentId: payment.studentId, paymentId: id },
        })
        .catch(() => undefined);
    }

    return this.serialize(await this.refetch(id));
  }

  async voidPayment(id: string, reason: string, user: CurrentUser) {
    const payment = await this.prisma.payment.findFirst({ where: { id, deletedAt: null }, select: PAYMENT_SELECT });
    if (!payment) throw new NotFoundException('Платёж не найден');
    if (payment.status !== 'APPROVED') {
      throw new ConflictException('Аннулировать можно только проведённый (одобренный) платёж');
    }

    const trimmedReason = reason.trim();
    const now = new Date();
    const result = await this.prisma.payment.updateMany({
      where: { id, status: 'APPROVED', deletedAt: null },
      // approvedAt/approvedById НЕ обнуляются — дата проведения остаётся для аудита.
      data: { status: 'VOID', voidedById: user.id, voidedAt: now, voidReason: trimmedReason },
    });
    if (result.count === 0) throw new ConflictException('Статус платежа изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_VOID',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: `Аннулирован: ${trimmedReason}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(payment.student, 'payment:voided', { studentId: payment.studentId, paymentId: id }, { studentId: payment.studentId });
    if (payment.createdById) {
      this.notifications
        .notifyUser(payment.createdById, {
          type: 'PAYMENT_VOID',
          title: 'Платёж аннулирован',
          message: `${payment.student.fullName}: ранее одобренный платёж аннулирован Основателем. Причина: ${trimmedReason}`,
          payload: { studentId: payment.studentId, paymentId: id },
        })
        .catch(() => undefined);
    }

    return this.serialize(await this.refetch(id));
  }

  async remove(id: string, user: CurrentUser) {
    const payment = await this.loadPaymentForMutation(id, user);
    if (!EDITABLE_STATUSES.has(payment.status)) {
      throw new ConflictException(
        payment.status === 'APPROVED'
          ? 'Проведённый платёж нельзя удалить — аннулируйте его (VOID)'
          : 'Удалить можно только черновик или отклонённый платёж',
      );
    }

    const result = await this.prisma.payment.updateMany({
      where: { id, status: payment.status, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw new ConflictException('Статус платежа изменился, обновите страницу');

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_DELETE',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: `Удалён черновик платежа: ${this.money(payment.amount)} TJS`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(payment.student, 'payment:deleted', { studentId: payment.studentId, paymentId: id }, { studentId: payment.studentId });

    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Запись — чеки
  // ------------------------------------------------------------------

  async addReceipt(id: string, file: ReceiptFileInput | undefined, user: CurrentUser) {
    if (!file) throw new BadRequestException('Файл не передан');
    const payment = await this.loadPaymentForMutation(id, user);
    if (!EDITABLE_STATUSES.has(payment.status)) {
      throw new ConflictException('Догрузить чек можно только к черновику или отклонённому платежу');
    }

    const doc = await this.prisma.document.create({
      data: {
        studentId: payment.studentId,
        paymentId: id,
        type: 'RECEIPT',
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        url: file.url,
      },
    });

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        // Раздел 6.3 ТЗ (волна 4): было PAYMENT_UPDATE — «прикрепление чеков»
        // было неотличимо от правки суммы/назначения платежа в фильтре ленты.
        action: 'PAYMENT_RECEIPT_ADD',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: 'Добавлен чек к платежу',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      payment.student,
      'payment:receipt-added',
      { studentId: payment.studentId, paymentId: id, docId: doc.id },
      { studentId: payment.studentId },
    );

    return doc;
  }

  async removeReceipt(docId: string, user: CurrentUser) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, deletedAt: null, type: 'RECEIPT', paymentId: { not: null } },
      include: { payment: { select: PAYMENT_SELECT } },
    });
    if (!doc || !doc.payment) throw new NotFoundException('Чек не найден');
    const payment = doc.payment;

    const allowed = isPrivileged(user.role) || payment.createdById === user.id;
    // 404, а не 403 — иначе по коду ответа подтверждается существование чека
    // у чужого платежа (тот же приём, что в loadPaymentForMutation).
    if (!allowed) {
      throw new NotFoundException('Чек не найден');
    }
    if (!EDITABLE_STATUSES.has(payment.status)) {
      throw new ConflictException('Удалить чек можно только у черновика или отклонённого платежа');
    }

    // Проблема 4 аудита волны 1: если purpose требует чек (Проживание/Питание),
    // нельзя удалить ПОСЛЕДНИЙ живой чек — иначе сохранённый платёж останется
    // без обязательного подтверждающего документа (ТЗ 1.3). Считаем живые чеки
    // ДО удаления и передаём в assertReceiptInvariant «останется ли чек ПОСЛЕ» —
    // ровно на 1 меньше текущего количества.
    //
    // Счёт и удаление — в ОДНОЙ транзакции, симметрично update(). Иначе два
    // параллельных удаления двух последних чеков оба увидели бы count=2,
    // оба прошли бы проверку, и платёж «Проживание» остался бы без чека.
    // Условие deletedAt: null в WHERE самого update делает операцию
    // идемпотентной: повторное удаление того же чека не пройдёт.
    await this.prisma.$transaction(async (tx) => {
      const liveReceiptsCount = await tx.document.count({
        where: { paymentId: payment.id, type: 'RECEIPT', deletedAt: null },
      });
      assertReceiptInvariant(payment.purpose, liveReceiptsCount > 1);
      const res = await tx.document.updateMany({
        where: { id: docId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (res.count === 0) throw new ConflictException('Чек уже удалён, обновите страницу');
    });
    // Проблема 9 (инвалидация кэша /uploads): без сброса приватный кэш
    // FileResolverService мог бы ещё до 5 минут отдавать только что удалённый чек.
    this.fileResolver.invalidateForStudent(payment.studentId);

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        // Раздел 6.3 ТЗ (волна 4): было PAYMENT_UPDATE — та же причина, что у addReceipt().
        action: 'PAYMENT_RECEIPT_REMOVE',
        studentId: payment.studentId,
        studentName: payment.student.fullName,
        details: 'Удалён чек платежа',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      payment.student,
      'payment:receipt-removed',
      { studentId: payment.studentId, paymentId: payment.id, docId },
      { studentId: payment.studentId },
    );

    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Запись — график платежей (план)
  // ------------------------------------------------------------------

  async setSchedule(dto: SetScheduleDto, user: CurrentUser) {
    if (STAGE_KIND[dto.stage] !== 'SCHEDULE') {
      throw new BadRequestException('У расходов на месте (Этап 4) нет плановой суммы — это фактические расходы, а не график');
    }
    const student = await this.loadStudentScope(dto.studentId);

    const plannedAmount = this.parseAmount(dto.plannedAmount, { allowZero: true });
    const dueDate = dto.dueDate ? this.parseDate(dto.dueDate, 'Некорректная дата срока оплаты') : null;

    // Комментарий обновляем ТОЛЬКО если поле реально передали — по образцу
    // update() платежа. Безусловная запись стирала сохранённый комментарий
    // при каждом повторном сохранении плана: клиент, который поле не
    // редактирует, шлёт undefined, и `dto.comment?.trim() || null` превращало
    // это в затирание null.
    const scheduleUpdate: Prisma.PaymentScheduleUncheckedUpdateInput = {
      plannedAmount,
      dueDate,
      updatedById: user.id,
      deletedAt: null,
    };
    if (dto.comment !== undefined) scheduleUpdate.comment = dto.comment?.trim() || null;

    const row = await this.prisma.paymentSchedule.upsert({
      where: { studentId_stage: { studentId: dto.studentId, stage: dto.stage } },
      update: scheduleUpdate,
      create: {
        studentId: dto.studentId,
        stage: dto.stage,
        stageOrder: STAGE_ORDER[dto.stage],
        plannedAmount,
        dueDate,
        comment: dto.comment?.trim() || null,
        updatedById: user.id,
      },
    });

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'PAYMENT_SCHEDULE_UPDATE',
        studentId: dto.studentId,
        studentName: student.fullName,
        details: `План «${STAGE_LABEL[dto.stage]}»: ${this.money(plannedAmount)} TJS${dueDate ? `, срок ${dueDate.toISOString().slice(0, 10)}` : ''}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(student, 'payment:schedule-updated', { studentId: dto.studentId, stage: dto.stage }, { studentId: dto.studentId });

    return { ...row, plannedAmount: this.money(row.plannedAmount) };
  }
}
