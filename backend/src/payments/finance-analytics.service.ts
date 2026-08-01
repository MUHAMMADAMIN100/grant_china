import { Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentPurpose, PaymentStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { localDayStart } from '../scheduler/time';
import { PaymentsService } from './payments.service';
import { METHOD_LABEL, PURPOSE_LABEL, STAGE_LABEL } from './payment-rules';

export interface AnalyticsPeriod {
  from?: Date;
  to?: Date;
}

/** Плоская пара "сумма + количество" — базовая единица почти всех срезов аналитики. */
interface AmountCount {
  count: number;
  amount: string;
}

export interface FinanceAnalyticsSummary {
  currency: 'TJS';
  period: { from: string | null; to: string | null };
  /** Итого поступлений за период — учитываются ТОЛЬКО APPROVED (Double Check, ТЗ 1.1). */
  totalApproved: AmountCount;
  byStage: Array<{ stage: PaymentStage; label: string; count: number; amount: string }>;
  byPurpose: Array<{ purpose: PaymentPurpose; label: string; count: number; amount: string }>;
  byMethod: Array<{ method: PaymentMethod; label: string; count: number; amount: string }>;
  /** «Кто сколько собрал» — по автору платежа (createdById), не по назначенному менеджеру студента:
   *  именно тот, кто фактически внёс поступление в систему. См. Payment.createdById в schema.prisma. */
  byManager: Array<{ managerId: string | null; managerName: string; count: number; amount: string }>;
  /** Динамика по месяцам paidAt внутри периода, формат 'YYYY-MM', по возрастанию. */
  monthly: Array<{ month: string; count: number; amount: string }>;
  /** Не зависит от периода — снимок текущей очереди (как payments.service.pendingCount()). */
  pendingApproval: AmountCount;
  /** Не зависит от периода — текущий срез: dueDate графика прошёл, а сумма не покрыта APPROVED-оплатами. */
  overdue: AmountCount;
  /** Не зависит от периода — сколько ещё должно прийти по всему графику (план минус уже одобренное). */
  plannedRemaining: { amount: string };
}

const money = (value: Prisma.Decimal | number | string | null | undefined): string =>
  new Prisma.Decimal(value ?? 0).toFixed(2);

/**
 * Финансовая аналитика Основателя (раздел 2.6 ТЗ). Сознательно вынесена из
 * PaymentsService в отдельный сервис: PaymentsService отвечает за CRUD и
 * Double Check одного платежа, здесь — только агрегаты по всему портфелю
 * (иначе один файл разросся бы до двух несвязанных ответственностей).
 * pendingCount() переиспользуется из PaymentsService, а не дублируется —
 * это тот же снимок очереди на одобрение, что и на странице «Финансы».
 *
 * Все суммы считаются агрегациями в БД (groupBy/aggregate/$queryRaw),
 * НИКАКИХ prisma.payment.findMany() с суммированием в JS — при 2000+
 * платежах на портфель это была бы либо N+1, либо загрузка всей таблицы
 * ради одного числа.
 */
@Injectable()
export class FinanceAnalyticsService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
  ) {}

  // Возвращаемый тип НАМЕРЕННО не аннотирован как `Promise<FinanceAnalyticsSummary>`
  // прямо в сигнатуре: TS 5.3/Prisma 5.22 в этой комбинации ($transaction()
  // c groupBy() внутри + аннотированный тип функции) даёт ложный TS2322 —
  // компилятор путает тип результата groupBy() с типом его АРГУМЕНТА (`_count`
  // резолвится как `true | PaymentCountAggregateInputType`, а не `number`).
  // Без аннотации на сигнатуре TS выводит тот же самый (структурно верный)
  // тип из object-литерала ниже — FinanceAnalyticsSummary остаётся описанием
  // контракта для внешних потребителей (контроллер/фронт), просто не как
  // явная аннотация здесь. Проверено: с аннотацией `npx tsc --noEmit` падает
  // на этом файле, без неё — проходит чисто.
  async summary(period: AnalyticsPeriod) {
    const approvedWhere: Prisma.PaymentWhereInput = { status: 'APPROVED', deletedAt: null };
    if (period.from || period.to) {
      approvedWhere.paidAt = {};
      if (period.from) (approvedWhere.paidAt as Prisma.DateTimeFilter).gte = period.from;
      if (period.to) (approvedWhere.paidAt as Prisma.DateTimeFilter).lte = period.to;
    }

    const monthlyWhere = this.buildMonthlyWhereSql(period);

    // Граница «сегодня» для просрочки — та же, что в карточке студента
    // (payments.service.summary): начало календарных суток ПО ДУШАНБЕ.
    // NOW() здесь означало бы полночь UTC, то есть 05:00 по Душанбе — этап
    // со сроком «сегодня» попадал бы в просрочку уже утром того же дня, и
    // сводка Основателя расходилась бы с карточкой, которую видит менеджер.
    const todayLocalStart = localDayStart(new Date());

    // Основные агрегаты идут одним батчем в $transaction — единый снимок
    // портфеля и один сетевой раунд-трип вместо 7 последовательных запросов.
    // pendingCount() — отдельный вызов сервиса (внутри у него свой
    // Promise.all на 2 лёгких запроса), в $transaction() его включить нельзя
    // (это не PrismaPromise), поэтому запускаем параллельно через Promise.all.
    const [transactionResults, pending] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.payment.aggregate({ where: approvedWhere, _sum: { amount: true }, _count: true }),
        this.prisma.payment.groupBy({
          by: ['stage'],
          where: approvedWhere,
          _sum: { amount: true },
          _count: true,
          orderBy: { stage: 'asc' },
        }),
        this.prisma.payment.groupBy({
          by: ['purpose'],
          where: approvedWhere,
          _sum: { amount: true },
          _count: true,
          orderBy: { purpose: 'asc' },
        }),
        this.prisma.payment.groupBy({
          by: ['method'],
          where: approvedWhere,
          _sum: { amount: true },
          _count: true,
          orderBy: { method: 'asc' },
        }),
        this.prisma.payment.groupBy({
          by: ['createdById'],
          where: approvedWhere,
          _sum: { amount: true },
          _count: true,
          orderBy: { createdById: 'asc' },
        }),
        this.prisma.$queryRaw<Array<{ month: string; count: bigint; amount: Prisma.Decimal }>>`
          SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month,
                 COUNT(*) AS count,
                 COALESCE(SUM("amount"), 0) AS amount
          FROM "Payment"
          WHERE ${monthlyWhere}
          GROUP BY 1
          ORDER BY 1
        `,
        // Просроченные + плановые поступления — снимок «сейчас», период не влияет:
        // сравниваем план (PaymentSchedule.plannedAmount) с уже одобренной оплатой
        // того же (studentId, stage). GREATEST(...,0) — если переплатили этап,
        // остаток не должен уходить в минус и «съедать» остаток других этапов.
        this.prisma.$queryRaw<Array<{ planned_remaining: Prisma.Decimal; overdue_count: bigint; overdue_amount: Prisma.Decimal }>>`
          WITH paid AS (
            SELECT "studentId", "stage", SUM("amount") AS total
            FROM "Payment"
            WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL
            GROUP BY "studentId", "stage"
          ),
          remaining AS (
            SELECT
              ps."dueDate" AS due_date,
              ps."stage" AS stage,
              GREATEST(ps."plannedAmount" - COALESCE(paid.total, 0), 0) AS remaining,
              -- Признак «этап 2.1 уже разблокирован» тащим В SELECT, а не в
              -- WHERE: эта CTE питает ОБА показателя. В WHERE он вычёркивал
              -- план 2.1 непройденного пайплайна и из просрочки (это верно), и
              -- из «Остатка по плану» (это ошибка) — плитка Основателя
              -- занижалась, а карточка студента (payments.service.summary)
              -- продолжала включать заблокированный этап в totals.remaining.
              EXISTS (
                SELECT 1 FROM "Application" a WHERE a."studentId" = ps."studentId"
                  AND a."deletedAt" IS NULL AND a."status" IN ('ENROLLED', 'COMPLETED')
              ) AS is_enrolled
            FROM "PaymentSchedule" ps
            -- JOIN на Student обязателен: soft-delete студента НЕ трогает его
            -- строки в PaymentSchedule (данные не удаляем), и без этого условия
            -- планы отчисленных студентов вечно висели бы в plannedRemaining,
            -- а их сроки — в растущей «просрочке», которую невозможно закрыть.
            JOIN "Student" s ON s."id" = ps."studentId" AND s."deletedAt" IS NULL
            LEFT JOIN paid ON paid."studentId" = ps."studentId" AND paid."stage" = ps."stage"
            WHERE ps."deletedAt" IS NULL AND ps."plannedAmount" > 0
          )
          -- Гейт «этап 2.1 только у зачисленных» стоит ТОЛЬКО в фильтрах
          -- просрочки: create() отвечает 409 на попытку оплатить 2.1 до
          -- зачисления, значит закрыть такую просрочку физически нечем.
          -- Карточка студента (payments.service.summary, locked) и метрика
          -- своевременности (kpi.service) исключают его ровно так же — из
          -- просрочки, но не из плана.
          SELECT
            COALESCE(SUM(remaining), 0) AS planned_remaining,
            COUNT(*) FILTER (
              WHERE due_date IS NOT NULL AND due_date < ${todayLocalStart} AND remaining > 0
                AND (stage <> 'ENROLLMENT' OR is_enrolled)
            ) AS overdue_count,
            COALESCE(SUM(remaining) FILTER (
              WHERE due_date IS NOT NULL AND due_date < ${todayLocalStart} AND remaining > 0
                AND (stage <> 'ENROLLMENT' OR is_enrolled)
            ), 0) AS overdue_amount
          FROM remaining
        `,
      ]),
      this.payments.pendingCount(),
    ]);
    const [totalAgg, byStageRows, byPurposeRows, byMethodRows, byManagerRows, monthlyRows, overduePlannedRows] =
      transactionResults;

    const managerIds = byManagerRows.map((r) => r.createdById).filter((id): id is string => Boolean(id));
    const managers = managerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, fullName: true } })
      : [];
    const managerNameById = new Map(managers.map((m) => [m.id, m.fullName]));

    const overduePlanned = overduePlannedRows[0];

    return {
      currency: 'TJS',
      period: { from: period.from ? period.from.toISOString() : null, to: period.to ? period.to.toISOString() : null },
      totalApproved: { count: totalAgg._count, amount: money(totalAgg._sum.amount) },
      byStage: byStageRows.map((r) => ({
        stage: r.stage,
        label: STAGE_LABEL[r.stage],
        count: r._count,
        amount: money(r._sum?.amount),
      })),
      byPurpose: byPurposeRows.map((r) => ({
        purpose: r.purpose,
        label: PURPOSE_LABEL[r.purpose],
        count: r._count,
        amount: money(r._sum?.amount),
      })),
      byMethod: byMethodRows.map((r) => ({
        method: r.method,
        label: METHOD_LABEL[r.method],
        count: r._count,
        amount: money(r._sum?.amount),
      })),
      byManager: byManagerRows.map((r) => ({
        managerId: r.createdById,
        // Ищем БЕЗ фильтра deletedAt (см. managers выше) — уволенный сотрудник
        // должен остаться в историческом отчёте под своим настоящим именем,
        // а не "Неизвестный". Фолбэк здесь — на случай гипотетического
        // рассинхрона данных (FK не должен такое допускать), а не на увольнение.
        managerName: r.createdById ? managerNameById.get(r.createdById) || 'Сотрудник не найден' : 'Без автора',
        count: r._count,
        amount: money(r._sum?.amount),
      })),
      monthly: monthlyRows.map((r) => ({ month: r.month, count: Number(r.count), amount: money(r.amount) })),
      pendingApproval: { count: pending.count, amount: pending.totalAmount },
      overdue: {
        count: overduePlanned ? Number(overduePlanned.overdue_count) : 0,
        amount: money(overduePlanned?.overdue_amount),
      },
      plannedRemaining: { amount: money(overduePlanned?.planned_remaining) },
    };
  }

  /** Собирает WHERE для $queryRaw динамики по месяцам — тот же фильтр, что approvedWhere, но как Prisma.Sql. */
  private buildMonthlyWhereSql(period: AnalyticsPeriod): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`"status" = 'APPROVED'`, Prisma.sql`"deletedAt" IS NULL`];
    if (period.from) parts.push(Prisma.sql`"paidAt" >= ${period.from}`);
    if (period.to) parts.push(Prisma.sql`"paidAt" <= ${period.to}`);
    return Prisma.join(parts, ' AND ');
  }
}
