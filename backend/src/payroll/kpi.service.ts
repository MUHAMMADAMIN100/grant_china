import { Injectable } from '@nestjs/common';
import { PaymentStage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodRange } from './period';

/**
 * Раздел 5 ТЗ (волна 6) — расчёт четырёх метрик KPI менеджеров (ТЗ 5.1).
 * ВСЁ агрегациями в БД (count/aggregate/groupBy/$queryRaw), НИКАКИХ выборок
 * всех строк с суммированием в JS — личный кабинет менеджера открывается
 * часто, тяжёлый запрос там недопустим (см. риски проекта архитектора).
 *
 * Определения (обоснование — см. kpiMetrics проекта архитектора):
 *  - «Обработанный лид» = Application.firstTouchAt в периоде (НЕ createdAt).
 *  - «Лид» для конверсии = Application (не консультация — см. апі); числитель
 *    конверсии — Contract.signedAt в периоде того же менеджера. Это
 *    ПЕРИОДНЫЙ CR, а не когортный: числитель и знаменатель — не обязательно
 *    одни и те же физические заявки, зато число фиксируется вместе с
 *    периодом и никогда не меняется задним числом — критично для зарплаты.
 *  - «Своевременность» — оплата по этапу (SCHEDULE, dueDate задан) вовремя,
 *    если paidAt < dueDate + 1 день (округление КАЛЕНДАРНОГО дня в пользу
 *    сотрудника). Считается ПО СУММАМ (не по количеству) и включает третье
 *    слагаемое — непокрытый остаток по этапам, чей срок наступил в периоде
 *    (иначе метрика поощряла бы игнорирование неплативших студентов).
 *  - «Доведение» — win-rate по ЗАКРЫТЫМ за период заявкам: зачислен
 *    (Application.enrolledAt) против потерян (архивирован без зачисления).
 *    Переезд — Contract.relocatedAt, отдельная метрика.
 *
 * ПРИМЕЧАНИЕ ПО $transaction: raw-запросы, обёрнутые в собственный async-метод
 * (await внутри), теряют тип PrismaPromise и не могут идти внутри массива
 * this.prisma.$transaction([...]) — только «сырые» PrismaPromise-вызовы
 * (finance-analytics.service.ts делает так же). Поэтому такие запросы
 * запускаются параллельно через Promise.all() рядом с транзакцией, а не
 * внутри неё — для read-only агрегации за закрытый период разница в
 * консистентности снимка несущественна.
 */

export interface TimelinessBreakdown {
  onTimeAmount: Prisma.Decimal;
  lateAmount: Prisma.Decimal;
  missedAmount: Prisma.Decimal;
}

export interface ManagerPeriodMetrics {
  leadsProcessed: number;
  consultationsHeld: number;
  contractsSigned: number;
  /** Σ Contract.amount подписанных в периоде — база PERCENT_OF_CONTRACTS. */
  contractsAmount: Prisma.Decimal;
  enrolledCount: number;
  relocatedCount: number;
  /** Архивировано за период без зачисления — знаменатель deliveryRate. */
  lostCount: number;
  /** Доля 0..1 либо null — «нет базы», НЕ ноль. */
  conversionRate: Prisma.Decimal | null;
  deliveryRate: Prisma.Decimal | null;
  timelinessRate: Prisma.Decimal | null;
  timeliness: TimelinessBreakdown;
  /** Σ APPROVED-платежей, paidAt в периоде — база PERCENT_OF_PAYMENTS. */
  paymentsAmountTotal: Prisma.Decimal;
  paymentsAmountByStage: Partial<Record<PaymentStage, Prisma.Decimal>>;
}

const ZERO = new Prisma.Decimal(0);

function toDecimal(v: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(v ?? 0);
}

/** Доля 0..1, null при нулевом (или отрицательном) знаменателе — «нет базы», а не 0%. */
function safeRate(numerator: Prisma.Decimal | number, denominator: Prisma.Decimal | number): Prisma.Decimal | null {
  const den = toDecimal(denominator);
  if (den.lessThanOrEqualTo(0)) return null;
  return toDecimal(numerator).dividedBy(den);
}

function emptyMetrics(): ManagerPeriodMetrics {
  return {
    leadsProcessed: 0,
    consultationsHeld: 0,
    contractsSigned: 0,
    contractsAmount: ZERO,
    enrolledCount: 0,
    relocatedCount: 0,
    lostCount: 0,
    conversionRate: null,
    deliveryRate: null,
    timelinessRate: null,
    timeliness: { onTimeAmount: ZERO, lateAmount: ZERO, missedAmount: ZERO },
    paymentsAmountTotal: ZERO,
    paymentsAmountByStage: {},
  };
}

function finalizeRates(m: ManagerPeriodMetrics): void {
  m.conversionRate = safeRate(m.contractsSigned, m.leadsProcessed);
  m.deliveryRate = safeRate(m.enrolledCount, m.enrolledCount + m.lostCount);
  const denom = m.timeliness.onTimeAmount.plus(m.timeliness.lateAmount).plus(m.timeliness.missedAmount);
  m.timelinessRate = safeRate(m.timeliness.onTimeAmount, denom);
}

@Injectable()
export class KpiService {
  constructor(private prisma: PrismaService) {}

  // ВНИМАНИЕ: возвращаемые типы НАМЕРЕННО не аннотированы `Promise<...>` на
  // сигнатурах ниже — та же ловушка TS 5.3/Prisma 5.22, что задокументирована
  // в finance-analytics.service.ts (`$transaction()` c `groupBy()` внутри +
  // аннотированный тип функции даёт ложный TS2322, путая тип результата
  // groupBy() с типом его аргумента `_count`). Без аннотации TS выводит тот
  // же структурно верный тип из тела функции. Проверено: с аннотацией
  // `npx tsc --noEmit` падает, без неё — проходит чисто.

  /** Метрики ОДНОГО менеджера за период — личный кабинет, расчёт листа. */
  async forManager(managerId: string, range: PeriodRange) {
    return this.computeSingle(managerId, range);
  }

  /**
   * Метрики ВСЕЙ команды (без разбивки по людям) — используется для
   * BonusRule.metricScope = TEAM и (с k-анонимностью на вызывающей стороне)
   * для отображения «командного» числа в кабинете сотрудника.
   */
  async forTeam(range: PeriodRange) {
    return this.computeSingle(undefined, range);
  }

  private async computeSingle(managerId: string | undefined, range: PeriodRange) {
    const managerFilter = managerId ? managerId : { not: null };

    const [transactionResults, timelinessRows] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.application.count({
          where: { deletedAt: null, firstTouchById: managerFilter as any, firstTouchAt: { gte: range.from, lt: range.to } },
        }),
        this.prisma.consultation.count({
          where: { deletedAt: null, managerId: managerFilter as any, heldAt: { gte: range.from, lt: range.to } },
        }),
        this.prisma.contract.aggregate({
          where: { deletedAt: null, managerId: managerFilter as any, signedAt: { gte: range.from, lt: range.to } },
          _count: true,
          _sum: { amount: true },
        }),
        this.prisma.contract.count({
          where: { deletedAt: null, managerId: managerFilter as any, relocatedAt: { gte: range.from, lt: range.to } },
        }),
        this.prisma.application.count({
          where: { deletedAt: null, enrolledById: managerFilter as any, enrolledAt: { gte: range.from, lt: range.to } },
        }),
        this.prisma.application.count({
          where: {
            deletedAt: null,
            managerId: managerFilter as any,
            enrolledAt: null,
            archivedAt: { gte: range.from, lt: range.to },
          },
        }),
        this.prisma.payment.groupBy({
          by: ['stage'],
          where: {
            deletedAt: null,
            status: 'APPROVED',
            paidAt: { gte: range.from, lt: range.to },
            contract: managerId ? { managerId, deletedAt: null } : { managerId: { not: null }, deletedAt: null },
          },
          _sum: { amount: true },
          orderBy: { stage: 'asc' },
        }),
      ]),
      this.timelinessQuery(managerId, range),
    ]);
    const [leadsProcessed, consultationsHeld, contractsAgg, relocatedCount, enrolledCount, lostCount, paymentsByStageRows] =
      transactionResults;

    const metrics = emptyMetrics();
    metrics.leadsProcessed = leadsProcessed;
    metrics.consultationsHeld = consultationsHeld;
    // Number(...) / ?. — защита от известной ловушки TS/Prisma (см. комментарий
    // выше): без неё компилятор иногда путает тип РЕЗУЛЬТАТА _count/_sum с
    // типом их ВХОДНОГО аргумента. Рантайм-значение всегда число/Decimal|null.
    metrics.contractsSigned = Number(contractsAgg._count);
    metrics.contractsAmount = toDecimal(contractsAgg._sum?.amount);
    metrics.relocatedCount = relocatedCount;
    metrics.enrolledCount = enrolledCount;
    metrics.lostCount = lostCount;
    for (const row of paymentsByStageRows) {
      const amount = toDecimal(row._sum?.amount);
      metrics.paymentsAmountByStage[row.stage] = amount;
      metrics.paymentsAmountTotal = metrics.paymentsAmountTotal.plus(amount);
    }
    metrics.timeliness = timelinessRows;
    finalizeRates(metrics);
    return metrics;
  }

  /**
   * Метрики ВСЕХ переданных менеджеров одним батчем — сводная ведомость
   * (/payroll/summary), срез KPI руководства, генерация листов за период.
   * groupBy вместо N вызовов forManager() — 7 запросов на весь отдел вместо
   * 7 на каждого сотрудника (см. риски проекта архитектора, риск 2).
   */
  async forManagers(managerIds: string[], range: PeriodRange) {
    const idSet = new Set(managerIds);
    const result = new Map<string, ManagerPeriodMetrics>();
    for (const id of idSet) result.set(id, emptyMetrics());
    if (idSet.size === 0) return result;

    const [transactionResults, timelinessRows] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.application.groupBy({
          by: ['firstTouchById'],
          where: { deletedAt: null, firstTouchById: { in: managerIds }, firstTouchAt: { gte: range.from, lt: range.to } },
          _count: true,
          orderBy: { firstTouchById: 'asc' },
        }),
        this.prisma.consultation.groupBy({
          by: ['managerId'],
          where: { deletedAt: null, managerId: { in: managerIds }, heldAt: { gte: range.from, lt: range.to } },
          _count: true,
          orderBy: { managerId: 'asc' },
        }),
        this.prisma.contract.groupBy({
          by: ['managerId'],
          where: { deletedAt: null, managerId: { in: managerIds }, signedAt: { gte: range.from, lt: range.to } },
          _count: true,
          _sum: { amount: true },
          orderBy: { managerId: 'asc' },
        }),
        this.prisma.contract.groupBy({
          by: ['managerId'],
          where: { deletedAt: null, managerId: { in: managerIds }, relocatedAt: { gte: range.from, lt: range.to } },
          _count: true,
          orderBy: { managerId: 'asc' },
        }),
        this.prisma.application.groupBy({
          by: ['enrolledById'],
          where: { deletedAt: null, enrolledById: { in: managerIds }, enrolledAt: { gte: range.from, lt: range.to } },
          _count: true,
          orderBy: { enrolledById: 'asc' },
        }),
        this.prisma.application.groupBy({
          by: ['managerId'],
          where: {
            deletedAt: null,
            managerId: { in: managerIds },
            enrolledAt: null,
            archivedAt: { gte: range.from, lt: range.to },
          },
          _count: true,
          orderBy: { managerId: 'asc' },
        }),
        this.prisma.$queryRaw<Array<{ manager_id: string; stage: PaymentStage; amount: Prisma.Decimal }>>`
          SELECT c."managerId" AS manager_id, p."stage" AS stage, COALESCE(SUM(p."amount"), 0) AS amount
          FROM "Payment" p
          JOIN "Contract" c ON c.id = p."contractId" AND c."deletedAt" IS NULL
          WHERE p."deletedAt" IS NULL AND p."status" = 'APPROVED'
            AND c."managerId" IN (${Prisma.join(managerIds)})
            AND p."paidAt" >= ${range.from} AND p."paidAt" < ${range.to}
          GROUP BY 1, 2
        `,
      ]),
      this.timelinessByManagerQuery(managerIds, range),
    ]);
    const [leadsRows, consultRows, contractRows, relocatedRows, enrolledRows, lostRows, paymentsRows] = transactionResults;

    const pick = (id: string | null): ManagerPeriodMetrics | undefined => (id ? result.get(id) : undefined);

    // Number(...) / ?. — та же защита, что в computeSingle() выше.
    for (const r of leadsRows) {
      const m = pick(r.firstTouchById);
      if (m) m.leadsProcessed = Number(r._count);
    }
    for (const r of consultRows) {
      const m = pick(r.managerId);
      if (m) m.consultationsHeld = Number(r._count);
    }
    for (const r of contractRows) {
      const m = pick(r.managerId);
      if (m) {
        m.contractsSigned = Number(r._count);
        m.contractsAmount = toDecimal(r._sum?.amount);
      }
    }
    for (const r of relocatedRows) {
      const m = pick(r.managerId);
      if (m) m.relocatedCount = Number(r._count);
    }
    for (const r of enrolledRows) {
      const m = pick(r.enrolledById);
      if (m) m.enrolledCount = Number(r._count);
    }
    for (const r of lostRows) {
      const m = pick(r.managerId);
      if (m) m.lostCount = Number(r._count);
    }
    for (const r of paymentsRows) {
      const m = pick(r.manager_id);
      if (m) {
        const amount = toDecimal(r.amount);
        m.paymentsAmountByStage[r.stage] = amount;
        m.paymentsAmountTotal = m.paymentsAmountTotal.plus(amount);
      }
    }
    for (const r of timelinessRows) {
      const m = pick(r.manager_id);
      if (m) {
        m.timeliness = {
          onTimeAmount: toDecimal(r.on_time_amount),
          lateAmount: toDecimal(r.late_amount),
          missedAmount: toDecimal(r.missed_amount),
        };
      }
    }
    for (const m of result.values()) finalizeRates(m);
    return result;
  }

  /**
   * Сколько этапов (PaymentStage) полностью закрыто за период у менеджера —
   * база FIXED_PER_STAGE. Считается лениво (не входит в стандартный набор
   * метрик), вызывается bonus-engine ТОЛЬКО для этапов, реально
   * упомянутых в активных правилах.
   * «Закрыт» = нарастающий итог APPROVED-платежей по (studentId, stage)
   * ВПЕРВЫЕ достиг plannedAmount; дата закрытия — paidAt именно того платежа.
   *
   * ПОЧЕМУ не SUM/MAX(paidAt) по всем платежам этапа (так было раньше):
   * такая дата ЕЗДИТ ЗАДНИМ ЧИСЛОМ. Любая доплата по уже закрытому и
   * оплаченному этапу переносила этап в период последнего платежа — бонус за
   * него начислялся ВТОРОЙ раз, реальными деньгами. Обратный случай не менее
   * опасен: approve() перед заморозкой зовёт recalculateCore(), и если к тому
   * моменту по этапу прошла копеечная доплата следующим месяцем, этап уезжал
   * из утверждаемого периода — сотрудник молча терял заработанный бонус ровно
   * в момент утверждения листа. Момент первого покрытия плана не меняется от
   * более поздних платежей, а верхняя граница paidAt < range.to отсекает
   * будущее, поэтому закрытый период больше не переписывается.
   */
  async closedStagesCount(managerId: string | undefined, stage: PaymentStage, range: PeriodRange): Promise<number> {
    const managerCondition = managerId ? Prisma.sql`c."managerId" = ${managerId}` : Prisma.sql`c."managerId" IS NOT NULL`;
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      WITH running AS (
        SELECT p."studentId", p."stage", p."paidAt",
               SUM(p."amount") OVER (PARTITION BY p."studentId", p."stage" ORDER BY p."paidAt", p."id") AS paid_so_far
        FROM "Payment" p
        JOIN "Contract" c ON c.id = p."contractId" AND c."deletedAt" IS NULL AND ${managerCondition}
        WHERE p."deletedAt" IS NULL AND p."status" = 'APPROVED' AND p."kind" = 'SCHEDULE' AND p."stage" = ${stage}::"PaymentStage"
          AND p."paidAt" < ${range.to}
      ),
      closed AS (
        SELECT r."studentId", r."stage", MIN(r."paidAt") AS closed_at
        FROM running r
        JOIN "PaymentSchedule" ps ON ps."studentId" = r."studentId" AND ps."stage" = r."stage" AND ps."deletedAt" IS NULL
        WHERE r.paid_so_far >= ps."plannedAmount" AND ps."plannedAmount" > 0
        GROUP BY r."studentId", r."stage"
      )
      SELECT COUNT(*) AS count
      FROM closed
      WHERE closed_at >= ${range.from} AND closed_at < ${range.to}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private async timelinessQuery(managerId: string | undefined, range: PeriodRange): Promise<TimelinessBreakdown> {
    const managerCondition = managerId ? Prisma.sql`c."managerId" = ${managerId}` : Prisma.sql`c."managerId" IS NOT NULL`;
    const rows = await this.prisma.$queryRaw<
      Array<{ on_time_amount: Prisma.Decimal; late_amount: Prisma.Decimal; missed_amount: Prisma.Decimal }>
    >`
      WITH scoped AS (
        SELECT
          COALESCE(SUM(p."amount") FILTER (WHERE p."paidAt" < p."dueDate" + interval '1 day'), 0) AS on_time_amount,
          COALESCE(SUM(p."amount") FILTER (WHERE p."paidAt" >= p."dueDate" + interval '1 day'), 0) AS late_amount
        FROM "Payment" p
        JOIN "Contract" c ON c.id = p."contractId" AND c."deletedAt" IS NULL AND ${managerCondition}
        WHERE p."deletedAt" IS NULL AND p."status" = 'APPROVED' AND p."kind" = 'SCHEDULE'
          AND p."dueDate" IS NOT NULL AND p."paidAt" >= ${range.from} AND p."paidAt" < ${range.to}
      ),
      paid AS (
        SELECT "studentId", "stage", SUM("amount") AS total FROM "Payment"
        WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL AND "paidAt" < ${range.to}
        GROUP BY 1, 2
      ),
      missed AS (
        SELECT COALESCE(SUM(GREATEST(ps."plannedAmount" - COALESCE(paid.total, 0), 0)), 0) AS missed_amount
        FROM "PaymentSchedule" ps
        JOIN "Contract" c ON c.id = ps."contractId" AND c."deletedAt" IS NULL AND ${managerCondition}
        JOIN "Student" s ON s.id = ps."studentId" AND s."deletedAt" IS NULL
        LEFT JOIN paid ON paid."studentId" = ps."studentId" AND paid."stage" = ps."stage"
        WHERE ps."deletedAt" IS NULL AND ps."plannedAmount" > 0
          AND ps."dueDate" >= ${range.from} AND ps."dueDate" < ${range.to}
          AND (ps."stage" <> 'ENROLLMENT' OR EXISTS (
            SELECT 1 FROM "Application" a WHERE a."studentId" = ps."studentId"
              AND a."deletedAt" IS NULL AND a."status" IN ('ENROLLED', 'COMPLETED')))
      )
      SELECT scoped.on_time_amount, scoped.late_amount, missed.missed_amount
      FROM scoped, missed
    `;
    const row = rows[0];
    return {
      onTimeAmount: toDecimal(row?.on_time_amount),
      lateAmount: toDecimal(row?.late_amount),
      missedAmount: toDecimal(row?.missed_amount),
    };
  }

  private async timelinessByManagerQuery(
    managerIds: string[],
    range: PeriodRange,
  ): Promise<Array<{ manager_id: string; on_time_amount: Prisma.Decimal; late_amount: Prisma.Decimal; missed_amount: Prisma.Decimal }>> {
    if (managerIds.length === 0) return [];
    return this.prisma.$queryRaw<
      Array<{ manager_id: string; on_time_amount: Prisma.Decimal; late_amount: Prisma.Decimal; missed_amount: Prisma.Decimal }>
    >`
      WITH scoped AS (
        SELECT c."managerId" AS manager_id,
               COALESCE(SUM(p."amount") FILTER (WHERE p."paidAt" < p."dueDate" + interval '1 day'), 0) AS on_time_amount,
               COALESCE(SUM(p."amount") FILTER (WHERE p."paidAt" >= p."dueDate" + interval '1 day'), 0) AS late_amount
        FROM "Payment" p
        JOIN "Contract" c ON c.id = p."contractId" AND c."deletedAt" IS NULL AND c."managerId" IN (${Prisma.join(managerIds)})
        WHERE p."deletedAt" IS NULL AND p."status" = 'APPROVED' AND p."kind" = 'SCHEDULE'
          AND p."dueDate" IS NOT NULL AND p."paidAt" >= ${range.from} AND p."paidAt" < ${range.to}
        GROUP BY c."managerId"
      ),
      paid AS (
        SELECT "studentId", "stage", SUM("amount") AS total FROM "Payment"
        WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL AND "paidAt" < ${range.to}
        GROUP BY 1, 2
      ),
      missed AS (
        SELECT c."managerId" AS manager_id,
               COALESCE(SUM(GREATEST(ps."plannedAmount" - COALESCE(paid.total, 0), 0)), 0) AS missed_amount
        FROM "PaymentSchedule" ps
        JOIN "Contract" c ON c.id = ps."contractId" AND c."deletedAt" IS NULL AND c."managerId" IN (${Prisma.join(managerIds)})
        JOIN "Student" s ON s.id = ps."studentId" AND s."deletedAt" IS NULL
        LEFT JOIN paid ON paid."studentId" = ps."studentId" AND paid."stage" = ps."stage"
        WHERE ps."deletedAt" IS NULL AND ps."plannedAmount" > 0
          AND ps."dueDate" >= ${range.from} AND ps."dueDate" < ${range.to}
          AND (ps."stage" <> 'ENROLLMENT' OR EXISTS (
            SELECT 1 FROM "Application" a WHERE a."studentId" = ps."studentId"
              AND a."deletedAt" IS NULL AND a."status" IN ('ENROLLED', 'COMPLETED')))
        GROUP BY c."managerId"
      )
      SELECT
        COALESCE(scoped.manager_id, missed.manager_id) AS manager_id,
        COALESCE(scoped.on_time_amount, 0) AS on_time_amount,
        COALESCE(scoped.late_amount, 0) AS late_amount,
        COALESCE(missed.missed_amount, 0) AS missed_amount
      FROM scoped
      FULL OUTER JOIN missed ON missed.manager_id = scoped.manager_id
    `;
  }
}
