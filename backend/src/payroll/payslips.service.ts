import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { KpiMetric, PaymentStage, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KpiService, ManagerPeriodMetrics } from './kpi.service';
import { CompensationService } from './compensation.service';
import { RulesService, RuleSetWithRules } from './rules.service';
import { BonusLine, BonusRuleConfig, calculateBonus, metricValue } from './bonus-engine';
import { periodRangeFromKey, PeriodRange } from './period';
import { ApprovePayslipDto, PayPayslipDto, RecallPayslipDto, UpdatePayslipDto, VoidPayslipDto } from './dto/payslip.dto';

export type CurrentUser = { id: string; role: Role };

/**
 * Раздел 5 ТЗ (волна 6) — «зарплата — самые чувствительные данные в системе»
 * (замечание проекта архитектора). ДВЕ РАЗНЫЕ поверхности используют этот
 * сервис: PayrollMeController (свои данные, идентичность ТОЛЬКО из JWT,
 * userId в аргументах методов приходит из req.user, а не из query/body) и
 * PayrollAdminController (@Roles(FOUNDER, ADMIN) на классе). Методы для
 * второй поверхности принимают id листа явно, но loadForAdminMutation()
 * не проверяет владельца — эта проверка живёт в RolesGuard контроллера,
 * а анти-самоутверждение проверяется отдельно в approve().
 */

// «Метрика ведётся с ДД.ММ.ГГГГ» — раздел 5 (волна 6) выкатывается без
// бэкфилла (Application.firstTouchAt/enrolledAt, Contract.signedAt/relocatedAt
// у существующих 197 студентов/229 заявок = null). Подпись в UI поясняет
// нулевые метрики первого периода — не техническая проблема, а факт данных.
const METRICS_SINCE = '2026-07-31';

// k-анонимность командной метрики (см. accessModel проекта архитектора):
// при штате меньше этого числа отдельное число легко деанонимизировать.
const TEAM_K_ANONYMITY = 5;

// TTL кэша «живых» расчётов (KPI/предпросмотр) — экран кабинета менеджера
// открывается часто, а метрики за текущий (незакрытый) месяц не обязаны
// быть точны до секунды.
const LIVE_CACHE_TTL_MS = 60_000;

const PAYSLIP_SELECT = {
  id: true,
  userId: true,
  user: { select: { id: true, fullName: true, email: true, role: true } },
  periodStart: true,
  periodEnd: true,
  periodKey: true,
  revision: true,
  activeSlot: true,
  status: true,
  baseAmount: true,
  baseOverride: true,
  bonusAmount: true,
  kpiBonusAmount: true,
  adjustmentAmount: true,
  adjustmentReason: true,
  totalAmount: true,
  currency: true,
  ruleSetId: true,
  ruleSetVersion: true,
  formulaSnapshot: true,
  metricsSnapshot: true,
  breakdown: true,
  leadsProcessed: true,
  consultationsHeld: true,
  contractsSigned: true,
  enrolledCount: true,
  relocatedCount: true,
  conversionRate: true,
  timelinessRate: true,
  deliveryRate: true,
  needsReview: true,
  calculatedAt: true,
  calculatedById: true,
  calculatedBy: { select: { id: true, fullName: true } },
  approvedAt: true,
  approvedById: true,
  approvedBy: { select: { id: true, fullName: true } },
  paidAt: true,
  paidById: true,
  paidBy: { select: { id: true, fullName: true } },
  paidReference: true,
  voidedAt: true,
  voidedById: true,
  voidedBy: { select: { id: true, fullName: true } },
  voidReason: true,
  replacedById: true,
  // Обратный конец сторно-цепочки: какой аннулированный лист заменяет этот.
  // Связь 1:1 по факту (replacedById помечен @unique), массив — лишь форма,
  // в которой Prisma отдаёт обратную сторону отношения.
  replaces: { select: { id: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PayslipSelect;

type PayslipRow = Prisma.PayslipGetPayload<{ select: typeof PAYSLIP_SELECT }>;

@Injectable()
export class PayslipsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private notifications: NotificationsService,
    private realtime: RealtimeGateway,
    private kpi: KpiService,
    private compensation: CompensationService,
    private rules: RulesService,
  ) {}

  // ------------------------------------------------------------------
  // Вспомогательные функции
  // ------------------------------------------------------------------

  private money(v: Prisma.Decimal | number | string | null | undefined): string {
    return new Prisma.Decimal(v ?? 0).toFixed(2);
  }

  private rateStr(v: Prisma.Decimal | null): string | null {
    return v ? v.toFixed(4) : null;
  }

  private serialize(row: PayslipRow) {
    const { replaces, ...rest } = row;
    return {
      ...rest,
      // Плоский признак переиздания для интерфейса. Метку «переиздан» нельзя
      // рисовать по revision > 1: ревизия растёт и после удаления черновика
      // (remove не освобождает номер), а это первый выпуск листа, никакого
      // аннулирования и сторно не было. Здесь же — факт: непусто только у
      // листа, выпущенного через reissue() взамен аннулированного.
      replacesId: replaces[0]?.id ?? null,
      baseAmount: this.money(row.baseAmount),
      baseOverride: row.baseOverride ? this.money(row.baseOverride) : null,
      bonusAmount: this.money(row.bonusAmount),
      kpiBonusAmount: this.money(row.kpiBonusAmount),
      adjustmentAmount: this.money(row.adjustmentAmount),
      totalAmount: this.money(row.totalAmount),
      conversionRate: this.rateStr(row.conversionRate),
      timelinessRate: this.rateStr(row.timelinessRate),
      deliveryRate: this.rateStr(row.deliveryRate),
    };
  }

  private async refetch(id: string) {
    const row = await this.prisma.payslip.findUniqueOrThrow({ where: { id }, select: PAYSLIP_SELECT });
    return this.serialize(row);
  }

  /**
   * Следующая ревизия листа за период — max(revision)+1 по ВСЕМ строкам пары
   * (userId, periodKey), включая soft-удалённые (тот же приём, что в reissue).
   *
   * ПОЧЕМУ не константа 1: @@unique([userId, periodKey, revision]) про
   * deletedAt не знает, а remove() оставляет удалённый черновик в таблице с
   * его revision. С жёсткой единицей период после удаления черновика
   * блокировался НАВСЕГДА — createManual() отвечал 409, и лист за этот месяц
   * нельзя было создать уже ничем. То есть ревизия нужна ровно для того,
   * чтобы удалённый лист можно было пересоздать ОСОЗНАННЫМ ручным действием
   * (createManual/reissue). Идемпотентность generate() на неё не опирается:
   * генератор сам пропускает сотрудников, у которых за период уже есть живая
   * строка, — см. проверку decided в generate().
   */
  private async nextRevision(userId: string, periodKey: string): Promise<number> {
    const max = await this.prisma.payslip.aggregate({ where: { userId, periodKey }, _max: { revision: true } });
    return (max._max.revision ?? 0) + 1;
  }

  private async loadForAdminMutation(id: string): Promise<PayslipRow> {
    const row = await this.prisma.payslip.findFirst({ where: { id, deletedAt: null }, select: PAYSLIP_SELECT });
    if (!row) throw new NotFoundException('Расчётный лист не найден');
    return row;
  }

  /** «Итог выбился за предохранитель» — клампим отрицательный итог в 0 и флагаем needsReview (см. риск 4 проекта архитектора). */
  private evaluateTotal(
    base: Prisma.Decimal,
    bonus: Prisma.Decimal,
    kpiBonus: Prisma.Decimal,
    adjustment: Prisma.Decimal,
  ): { total: Prisma.Decimal; needsReview: boolean } {
    let total = base.plus(bonus).plus(kpiBonus).plus(adjustment);
    let needsReview = false;
    if (total.lessThan(0)) {
      total = new Prisma.Decimal(0);
      needsReview = true;
    }
    if (base.greaterThan(0) && total.greaterThan(base.times(3))) needsReview = true;
    // Отдельная ветка для сотрудника БЕЗ заведённой ставки: base = 0, и
    // проверка «итог больше трёх окладов» математически не срабатывает
    // никогда. То есть страховка отключалась ровно там, где контроля меньше
    // всего — у нового человека, которому оклад ещё не проставили, а бонус
    // уже начислился. Абсолютный порог ловит опечатку в проценте.
    const ABSOLUTE_REVIEW_THRESHOLD = 10_000;
    if (base.lessThanOrEqualTo(0) && total.greaterThan(ABSOLUTE_REVIEW_THRESHOLD)) {
      needsReview = true;
    }
    return { total, needsReview };
  }

  /**
   * Снимок применённых правил — кладётся в Payslip.formulaSnapshot и
   * возвращается владельцу листа.
   *
   * ФИЛЬТРАЦИЯ ПО ВЛАДЕЛЬЦУ ОБЯЗАТЕЛЬНА. Набор правил содержит и персональные
   * (scope = USER) — с чужими userId, ставками и суммами. Без фильтра
   * менеджер, открыв СВОЙ расчётный лист, читал бы условия бонусов всех
   * коллег: их проценты, фиксированные ставки и пороги. Это ровно та утечка,
   * ради предотвращения которой оклады вынесены в отдельную таблицу под
   * @Roles(FOUNDER) — и она обходилась через собственный, законно доступный
   * эндпоинт.
   *
   * Оставляем только правила, реально применимые к этому сотруднику:
   * общие (не USER-scope) и адресованные лично ему.
   */
  private snapshotFormula(ruleSet: RuleSetWithRules | null, ownerUserId: string) {
    if (!ruleSet) return { ruleSetId: null, version: null, rules: [] as unknown[] };
    const applicable = ruleSet.rules.filter(
      (r) => r.scope !== 'USER' || r.userId === ownerUserId,
    );
    return {
      ruleSetId: ruleSet.id,
      version: ruleSet.version,
      title: ruleSet.title,
      effectiveFrom: ruleSet.effectiveFrom.toISOString(),
      rules: applicable.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        scope: r.scope,
        userId: r.userId,
        rate: r.rate ? r.rate.toString() : null,
        amount: r.amount ? r.amount.toString() : null,
        threshold: r.threshold ? r.threshold.toString() : null,
        cap: r.cap ? r.cap.toString() : null,
        stage: r.stage,
        metric: r.metric,
        metricScope: r.metricScope,
        tierGroup: r.tierGroup,
        enabled: r.enabled,
        sortOrder: r.sortOrder,
      })),
    };
  }

  private snapshotMetrics(m: ManagerPeriodMetrics) {
    return {
      leadsProcessed: m.leadsProcessed,
      consultationsHeld: m.consultationsHeld,
      contractsSigned: m.contractsSigned,
      contractsAmount: m.contractsAmount.toFixed(2),
      enrolledCount: m.enrolledCount,
      relocatedCount: m.relocatedCount,
      lostCount: m.lostCount,
      conversionRate: this.rateStr(m.conversionRate),
      deliveryRate: this.rateStr(m.deliveryRate),
      timelinessRate: this.rateStr(m.timelinessRate),
      timeliness: {
        onTimeAmount: m.timeliness.onTimeAmount.toFixed(2),
        lateAmount: m.timeliness.lateAmount.toFixed(2),
        missedAmount: m.timeliness.missedAmount.toFixed(2),
      },
      paymentsAmountTotal: m.paymentsAmountTotal.toFixed(2),
      documentTypesAdded: m.documentTypesAdded,
    };
  }

  private metricsToApi(m: ManagerPeriodMetrics) {
    return {
      leadsProcessed: m.leadsProcessed,
      consultationsHeld: m.consultationsHeld,
      contractsSigned: m.contractsSigned,
      contractsAmount: this.money(m.contractsAmount),
      enrolledCount: m.enrolledCount,
      relocatedCount: m.relocatedCount,
      lostCount: m.lostCount,
      conversionRate: this.rateStr(m.conversionRate),
      timelinessRate: this.rateStr(m.timelinessRate),
      deliveryRate: this.rateStr(m.deliveryRate),
      documentTypesAdded: m.documentTypesAdded,
    };
  }

  /**
   * Ядро расчёта: оклад периода + метрики + применённые правила бонусов.
   * ИСПОЛЬЗУЕТСЯ generate/recalculate/approve/reissue/preview/simulate —
   * ЕДИНСТВЕННАЯ точка, где считаются деньги, чтобы предпросмотр сотрудника
   * и официальный лист руководства никогда не могли разойтись в формуле.
   */
  private async buildCalculation(
    user: { id: string; role: Role },
    range: PeriodRange,
    ruleSet: RuleSetWithRules | null,
    baseOverride: Prisma.Decimal | null = null,
  ): Promise<{ baseAmount: Prisma.Decimal; effectiveBase: Prisma.Decimal; metrics: ManagerPeriodMetrics; bonusAmount: Prisma.Decimal; kpiBonusAmount: Prisma.Decimal; breakdown: BonusLine[] }> {
    const baseAmountRaw = await this.compensation.effectiveAt(user.id, range.from);
    const baseAmount = baseAmountRaw ?? new Prisma.Decimal(0);
    // Контракт движка (bonus-engine.ts:46) — «оклад периода (baseOverride ??
    // baseSalary)»: KPI_THRESHOLD_BONUS со ставкой считает процент ОТ ЭТОГО
    // числа. Раньше в движок уходил только оклад из реестра, а baseOverride
    // Основателя применялся к одному итогу — премия в процентах молча
    // считалась от старой ставки. Реестровый baseAmount при этом возвращается
    // отдельно: в Payslip.baseAmount хранится именно он, а не подмена.
    const effectiveBase = baseOverride ?? baseAmount;
    const metrics = await this.kpi.forManager(user.id, range);

    let breakdown: BonusLine[] = [];
    let bonusAmount = new Prisma.Decimal(0);
    let kpiBonusAmount = new Prisma.Decimal(0);

    if (ruleSet) {
      const rules: BonusRuleConfig[] = this.rules.rulesForUser(ruleSet, user.id);
      if (rules.length) {
        const stagesNeeded = Array.from(
          new Set(rules.filter((r) => r.kind === 'FIXED_PER_STAGE' && r.stage).map((r) => r.stage as PaymentStage)),
        );
        const closedStagesByStage: Partial<Record<PaymentStage, number>> = {};
        for (const stage of stagesNeeded) {
          closedStagesByStage[stage] = await this.kpi.closedStagesCount(user.id, stage, range);
        }
        const needsTeam = rules.some((r) => r.kind === 'KPI_THRESHOLD_BONUS' && r.metricScope === 'TEAM');
        const teamMetrics = needsTeam ? await this.kpi.forTeam(range) : null;

        const result = calculateBonus(rules, { baseAmount: effectiveBase, personalMetrics: metrics, teamMetrics, closedStagesByStage });
        breakdown = result.breakdown;
        bonusAmount = result.bonusAmount;
        kpiBonusAmount = result.kpiBonusAmount;
      }
    }

    return { baseAmount, effectiveBase, metrics, bonusAmount, kpiBonusAmount, breakdown };
  }

  private async recalculateCore(existing: PayslipRow, actor: CurrentUser) {
    const range: PeriodRange = { key: existing.periodKey, from: existing.periodStart, to: existing.periodEnd };
    const ruleSet = await this.rules.activeSetFor(range.from);
    const calc = await this.buildCalculation(
      { id: existing.userId, role: existing.user.role },
      range,
      ruleSet as RuleSetWithRules | null,
      existing.baseOverride,
    );
    const { total, needsReview } = this.evaluateTotal(calc.effectiveBase, calc.bonusAmount, calc.kpiBonusAmount, existing.adjustmentAmount);

    return this.prisma.payslip.update({
      where: { id: existing.id },
      data: {
        baseAmount: calc.baseAmount,
        bonusAmount: calc.bonusAmount,
        kpiBonusAmount: calc.kpiBonusAmount,
        totalAmount: total,
        needsReview,
        ruleSetId: ruleSet?.id ?? null,
        ruleSetVersion: ruleSet?.version ?? null,
        formulaSnapshot: this.snapshotFormula(ruleSet as RuleSetWithRules | null, existing.userId) as unknown as Prisma.InputJsonValue,
        metricsSnapshot: this.snapshotMetrics(calc.metrics) as unknown as Prisma.InputJsonValue,
        breakdown: calc.breakdown as unknown as Prisma.InputJsonValue,
        leadsProcessed: calc.metrics.leadsProcessed,
        consultationsHeld: calc.metrics.consultationsHeld,
        contractsSigned: calc.metrics.contractsSigned,
        enrolledCount: calc.metrics.enrolledCount,
        relocatedCount: calc.metrics.relocatedCount,
        conversionRate: calc.metrics.conversionRate,
        timelinessRate: calc.metrics.timelinessRate,
        deliveryRate: calc.metrics.deliveryRate,
        calculatedAt: new Date(),
        calculatedById: actor.id,
      },
    });
  }

  // ------------------------------------------------------------------
  // Кабинет сотрудника (/payroll/me/*) — userId ВСЕГДА из JWT.
  // ------------------------------------------------------------------

  private liveCache = new Map<string, { expiresAt: number; value: Promise<any> }>();

  private cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.liveCache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as Promise<T>;
    const value = factory();
    value.catch(() => this.liveCache.delete(key));
    this.liveCache.set(key, { expiresAt: now + LIVE_CACHE_TTL_MS, value });
    return value;
  }

  private buildProgress(rules: BonusRuleConfig[], metrics: ManagerPeriodMetrics) {
    return rules
      .filter((r) => r.kind === 'KPI_THRESHOLD_BONUS' && r.metricScope === 'PERSONAL' && r.metric && r.threshold)
      .map((r) => {
        const value = metricValue(r.metric as KpiMetric, metrics);
        const threshold = r.threshold as Prisma.Decimal;
        const reached = value !== null && value.greaterThanOrEqualTo(threshold);
        return {
          ruleId: r.id,
          label: r.label,
          metric: r.metric,
          value: value !== null ? value.toFixed(4) : null,
          threshold: threshold.toFixed(4),
          reached,
          remaining: value !== null && !reached ? threshold.minus(value).toFixed(4) : null,
          reward: r.amount ? this.money(r.amount) : r.rate ? `${r.rate.times(100).toFixed(2)}% от оклада` : null,
        };
      });
  }

  /** GET /payroll/me/kpi — свои 4 метрики + прогресс к порогам премий. */
  async kpiForMe(userId: string, periodKey: string) {
    const range = periodRangeFromKey(periodKey);
    return this.cached(`kpi:${userId}:${range.key}`, async () => {
      const metrics = await this.kpi.forManager(userId, range);
      const ruleSet = await this.rules.activeSetFor(range.from);
      const rules = ruleSet ? this.rules.rulesForUser(ruleSet, userId) : [];
      const progress = this.buildProgress(rules, metrics);

      let team: { metric: KpiMetric; value: string; threshold: string } | null = null;
      const teamRule = rules.find((r) => r.kind === 'KPI_THRESHOLD_BONUS' && r.metricScope === 'TEAM' && r.metric && r.threshold);
      if (teamRule) {
        const teamSize = await this.prisma.user.count({ where: { deletedAt: null, role: { in: [Role.EMPLOYEE, Role.ADMIN] } } });
        if (teamSize >= TEAM_K_ANONYMITY) {
          const teamMetrics = await this.kpi.forTeam(range);
          const value = metricValue(teamRule.metric as KpiMetric, teamMetrics);
          if (value !== null) {
            team = { metric: teamRule.metric as KpiMetric, value: value.toFixed(4), threshold: (teamRule.threshold as Prisma.Decimal).toFixed(4) };
          }
        }
      }

      return {
        period: range.key,
        metricsSince: METRICS_SINCE,
        leadsProcessed: metrics.leadsProcessed,
        consultationsHeld: metrics.consultationsHeld,
        contractsSigned: metrics.contractsSigned,
        enrolledCount: metrics.enrolledCount,
        relocatedCount: metrics.relocatedCount,
        conversionRate: this.rateStr(metrics.conversionRate),
        timelinessRate: this.rateStr(metrics.timelinessRate),
        deliveryRate: this.rateStr(metrics.deliveryRate),
        progress,
        team,
      };
    });
  }

  /** GET /payroll/me/preview — предварительный расчёт, НИЧЕГО не пишет в БД. */
  async previewForMe(userId: string, periodKey: string) {
    const range = periodRangeFromKey(periodKey);
    return this.cached(`preview:${userId}:${range.key}`, async () => {
      const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, role: true } });
      if (!user) throw new NotFoundException('Пользователь не найден');
      const ruleSet = await this.rules.activeSetFor(range.from);
      const calc = await this.buildCalculation(user, range, ruleSet as RuleSetWithRules | null);
      const { total, needsReview } = this.evaluateTotal(calc.baseAmount, calc.bonusAmount, calc.kpiBonusAmount, new Prisma.Decimal(0));
      return {
        period: range.key,
        preliminary: true,
        metricsSince: METRICS_SINCE,
        baseAmount: this.money(calc.baseAmount),
        bonusAmount: this.money(calc.bonusAmount),
        kpiBonusAmount: this.money(calc.kpiBonusAmount),
        totalAmount: this.money(total),
        needsReview,
        breakdown: calc.breakdown,
        ruleSetVersion: ruleSet?.version ?? null,
      };
    });
  }

  async myList(userId: string, filters: { page?: number; pageSize?: number }) {
    const where: Prisma.PayslipWhereInput = { userId, deletedAt: null, status: { in: ['APPROVED', 'PAID', 'VOID'] } };
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 12));
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payslip.findMany({ where, orderBy: { periodStart: 'desc' }, skip, take: pageSize, select: PAYSLIP_SELECT }),
      this.prisma.payslip.count({ where }),
    ]);
    return { items: items.map((r) => this.serialize(r)), total, page, pageSize };
  }

  /**
   * GET /payroll/me/payslips/:id — владелец И статус !== DRAFT, иначе 404
   * (не быть оракулом существования — правило проекта, см. payments.service).
   */
  async findOneForMe(id: string, userId: string) {
    const row = await this.prisma.payslip.findFirst({ where: { id, deletedAt: null }, select: PAYSLIP_SELECT });
    if (!row || row.userId !== userId || row.status === 'DRAFT') {
      throw new NotFoundException('Расчётный лист не найден');
    }
    return this.serialize(row);
  }

  async myRules(userId: string) {
    const ruleSet = await this.rules.activeSetFor(new Date());
    if (!ruleSet) return { ruleSetVersion: null, rules: [] as unknown[] };
    const rules = this.rules.rulesForUser(ruleSet, userId);
    return {
      ruleSetVersion: ruleSet.version,
      rules: rules.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        scope: r.scope,
        rate: r.rate ? `${r.rate.times(100).toFixed(2)}%` : null,
        amount: r.amount ? this.money(r.amount) : null,
        threshold: this.rateStr(r.threshold),
        cap: r.cap ? this.money(r.cap) : null,
        stage: r.stage,
        metric: r.metric,
        metricScope: r.metricScope,
        tierGroup: r.tierGroup,
      })),
    };
  }

  async myCompensation(userId: string) {
    const amount = await this.compensation.effectiveAt(userId, new Date());
    return { baseSalary: amount ? this.money(amount) : null, currency: 'TJS' };
  }

  // ------------------------------------------------------------------
  // Руководство (/payroll/*) — @Roles(FOUNDER, ADMIN) на классе контроллера.
  // ------------------------------------------------------------------

  async summary(periodKey: string) {
    const rows = await this.prisma.payslip.findMany({
      where: { deletedAt: null, periodKey },
      orderBy: [{ user: { fullName: 'asc' } }],
      select: PAYSLIP_SELECT,
    });
    let fundApproved = new Prisma.Decimal(0);
    let fundPaid = new Prisma.Decimal(0);
    for (const r of rows) {
      if (r.status === 'APPROVED' || r.status === 'PAID') fundApproved = fundApproved.plus(r.totalAmount);
      if (r.status === 'PAID') fundPaid = fundPaid.plus(r.totalAmount);
    }
    return {
      period: periodKey,
      metricsSince: METRICS_SINCE,
      items: rows.map((r) => this.serialize(r)),
      fundApproved: this.money(fundApproved),
      fundPaid: this.money(fundPaid),
    };
  }

  async kpiForAdmin(periodKey: string, managerId?: string) {
    const range = periodRangeFromKey(periodKey);
    if (managerId) {
      const m = await this.kpi.forManager(managerId, range);
      return { period: range.key, metricsSince: METRICS_SINCE, items: [{ userId: managerId, ...this.metricsToApi(m) }] };
    }
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, role: { in: [Role.EMPLOYEE, Role.ADMIN] } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
    const metricsMap = await this.kpi.forManagers(users.map((u) => u.id), range);
    return {
      period: range.key,
      metricsSince: METRICS_SINCE,
      items: users.map((u) => ({ userId: u.id, fullName: u.fullName, role: u.role, ...this.metricsToApi(metricsMap.get(u.id)!) })),
    };
  }

  async findAllForAdmin(filters: { period?: string; userId?: string; status?: string; page?: number; pageSize?: number }) {
    const where: Prisma.PayslipWhereInput = { deletedAt: null };
    if (filters.period) where.periodKey = filters.period;
    if (filters.userId) where.userId = filters.userId;
    if (filters.status) where.status = filters.status as Prisma.PayslipWhereInput['status'];
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payslip.findMany({ where, orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }], skip, take: pageSize, select: PAYSLIP_SELECT }),
      this.prisma.payslip.count({ where }),
    ]);
    return { items: items.map((r) => this.serialize(r)), total, page, pageSize };
  }

  async findOneForAdmin(id: string) {
    const row = await this.prisma.payslip.findFirst({ where: { id, deletedAt: null }, select: PAYSLIP_SELECT });
    if (!row) throw new NotFoundException('Расчётный лист не найден');
    return this.serialize(row);
  }

  /**
   * POST /payroll/payslips/generate — идемпотентно создаёт DRAFT всем
   * EMPLOYEE/ADMIN. actor = null — системный вызов планировщика
   * (scheduler/jobs/payroll-period-close.job.ts), тот же приём, что
   * actorId: null у application-auto-archive.job.ts.
   */
  async generate(periodKey: string, actor: CurrentUser | null) {
    const range = periodRangeFromKey(periodKey);
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, role: { in: [Role.EMPLOYEE, Role.ADMIN] } },
      select: { id: true, role: true },
    });
    const ruleSet = await this.rules.activeSetFor(range.from);

    // Идемпотентность генератора НЕ может держаться на P2002: слот
    // @@unique([userId, periodKey, activeSlot]) освобождается и при удалении
    // черновика (remove: activeSlot = null), и при аннулировании
    // (voidPayslip: activeSlot = null). А джоба закрытия периода тикает раз в
    // час весь первый день месяца — лист, намеренно удалённый Основателем в
    // 09:30, к 10:00 создавался заново и мог уйти в выплату вместе со всей
    // ведомостью; аннулированный лист получал новый DRAFT в обход reissue(),
    // с оборванной сторно-цепочкой (replacedById остаётся null).
    // Решением по сотруднику за период считается ЛЮБАЯ строка — живая, любого
    // статуса (включая VOID), И soft-удалённая. Удалить черновик — это тоже
    // решение: «этого листа быть не должно», и генератор не вправе его
    // отменять. Фильтр по deletedAt здесь был бы ровно тем поведением, ради
    // устранения которого написан абзац выше: удалённый в 09:30 лист
    // возвращался бы в 10:00 следующим тиком джобы.
    // Пересоздать лист после удаления по-прежнему можно — но только руками,
    // через createManual() или reissue(), где ревизию и подбирает nextRevision().
    const existingRows = await this.prisma.payslip.findMany({
      where: { periodKey: range.key, userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    });
    const decided = new Set(existingRows.map((r) => r.userId));

    let created = 0;
    let skipped = 0;
    for (const u of users) {
      if (decided.has(u.id)) {
        skipped += 1;
        continue;
      }
      const calc = await this.buildCalculation(u, range, ruleSet as RuleSetWithRules | null);
      const { total, needsReview } = this.evaluateTotal(calc.baseAmount, calc.bonusAmount, calc.kpiBonusAmount, new Prisma.Decimal(0));
      const revision = await this.nextRevision(u.id, range.key);
      try {
        await this.prisma.payslip.create({
          data: {
            userId: u.id,
            periodStart: range.from,
            periodEnd: range.to,
            periodKey: range.key,
            revision,
            activeSlot: 'ACTIVE',
            status: 'DRAFT',
            baseAmount: calc.baseAmount,
            bonusAmount: calc.bonusAmount,
            kpiBonusAmount: calc.kpiBonusAmount,
            totalAmount: total,
            needsReview,
            ruleSetId: ruleSet?.id ?? null,
            ruleSetVersion: ruleSet?.version ?? null,
            formulaSnapshot: this.snapshotFormula(ruleSet as RuleSetWithRules | null, u.id) as unknown as Prisma.InputJsonValue,
            metricsSnapshot: this.snapshotMetrics(calc.metrics) as unknown as Prisma.InputJsonValue,
            breakdown: calc.breakdown as unknown as Prisma.InputJsonValue,
            leadsProcessed: calc.metrics.leadsProcessed,
            consultationsHeld: calc.metrics.consultationsHeld,
            contractsSigned: calc.metrics.contractsSigned,
            enrolledCount: calc.metrics.enrolledCount,
            relocatedCount: calc.metrics.relocatedCount,
            conversionRate: calc.metrics.conversionRate,
            timelinessRate: calc.metrics.timelinessRate,
            deliveryRate: calc.metrics.deliveryRate,
            calculatedAt: new Date(),
            calculatedById: actor?.id ?? null,
          },
        });
        created += 1;
      } catch (e) {
        // Остаётся страховкой от гонки: между выборкой existingRows и
        // create() лист мог создать параллельный прогон джобы или ручное
        // действие Основателя. Признаком идемпотентности эта ветка больше
        // не служит — её даёт проверка decided выше.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          skipped += 1;
          continue;
        }
        throw e;
      }
    }

    this.activity
      .log({
        actorId: actor?.id ?? null,
        actorName: actor ? undefined : 'Планировщик',
        actorRole: actor?.role ?? 'SYSTEM',
        action: 'PAYROLL_GENERATE',
        details: `Сгенерированы расчётные листы за ${range.key}: создано ${created}, пропущено ${skipped}`,
      })
      .catch(() => undefined);
    if (created > 0) {
      this.notifications
        .notifyFounders({
          type: 'PAYROLL_GENERATE',
          title: 'Расчётные листы сгенерированы',
          message: `За период ${range.key} создано ${created} листов (черновики)`,
        })
        .catch(() => undefined);
    }

    return { created, skipped, period: range.key };
  }

  /** POST /payroll/payslips/create — ручной лист (FOUNDER), берёт и уволенных (см. риск 9 проекта архитектора). */
  async createManual(userId: string, periodKey: string, actor: CurrentUser) {
    const user = await this.prisma.user.findFirst({ where: { id: userId }, select: { id: true, role: true, fullName: true } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const range = periodRangeFromKey(periodKey);
    const ruleSet = await this.rules.activeSetFor(range.from);
    const calc = await this.buildCalculation(user, range, ruleSet as RuleSetWithRules | null);
    const { total, needsReview } = this.evaluateTotal(calc.baseAmount, calc.bonusAmount, calc.kpiBonusAmount, new Prisma.Decimal(0));
    const revision = await this.nextRevision(user.id, range.key);

    const created = await this.prisma.payslip
      .create({
        data: {
          userId: user.id,
          periodStart: range.from,
          periodEnd: range.to,
          periodKey: range.key,
          revision,
          activeSlot: 'ACTIVE',
          status: 'DRAFT',
          baseAmount: calc.baseAmount,
          bonusAmount: calc.bonusAmount,
          kpiBonusAmount: calc.kpiBonusAmount,
          totalAmount: total,
          needsReview,
          ruleSetId: ruleSet?.id ?? null,
          ruleSetVersion: ruleSet?.version ?? null,
          formulaSnapshot: this.snapshotFormula(ruleSet as RuleSetWithRules | null, user.id) as unknown as Prisma.InputJsonValue,
          metricsSnapshot: this.snapshotMetrics(calc.metrics) as unknown as Prisma.InputJsonValue,
          breakdown: calc.breakdown as unknown as Prisma.InputJsonValue,
          leadsProcessed: calc.metrics.leadsProcessed,
          consultationsHeld: calc.metrics.consultationsHeld,
          contractsSigned: calc.metrics.contractsSigned,
          enrolledCount: calc.metrics.enrolledCount,
          relocatedCount: calc.metrics.relocatedCount,
          conversionRate: calc.metrics.conversionRate,
          timelinessRate: calc.metrics.timelinessRate,
          deliveryRate: calc.metrics.deliveryRate,
          calculatedAt: new Date(),
          calculatedById: actor.id,
        },
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('На этот период у сотрудника уже есть действующий расчётный лист');
        }
        throw e;
      });

    this.activity
      .log({ actorId: actor.id, actorRole: actor.role, action: 'PAYROLL_GENERATE', details: `Создан ручной лист ${user.fullName} за ${range.key}` })
      .catch(() => undefined);
    return this.refetch(created.id);
  }

  async recalculate(id: string, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'DRAFT') throw new ConflictException('Пересчитать можно только черновик');
    await this.recalculateCore(existing, actor);
    this.activity
      .log({ actorId: actor.id, actorRole: actor.role, action: 'PAYROLL_RECALC', details: `Пересчитан лист ${existing.user.fullName} за ${existing.periodKey}` })
      .catch(() => undefined);
    return this.refetch(id);
  }

  async update(id: string, dto: UpdatePayslipDto, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'DRAFT') throw new ConflictException('Изменить можно только черновик');

    if (dto.adjustmentAmount !== undefined && !dto.adjustmentReason?.trim()) {
      throw new BadRequestException('Укажите причину корректировки');
    }
    if (dto.baseOverride !== undefined && !dto.baseOverrideReason?.trim()) {
      throw new BadRequestException('Укажите причину замены оклада');
    }

    const adjustmentAmount = dto.adjustmentAmount !== undefined ? new Prisma.Decimal(dto.adjustmentAmount) : existing.adjustmentAmount;
    const adjustmentReason = dto.adjustmentAmount !== undefined ? dto.adjustmentReason!.trim() : existing.adjustmentReason;
    const baseOverride = dto.baseOverride !== undefined ? new Prisma.Decimal(dto.baseOverride) : existing.baseOverride;

    if (dto.baseOverride !== undefined) {
      // Замена оклада меняет БАЗУ процентных премий KPI (движок берёт процент
      // от оклада периода), поэтому сложить старые bonusAmount/kpiBonusAmount
      // с новой базой нельзя — премия осталась бы посчитанной от реестровой
      // ставки. Пишем новые поля и прогоняем движок целиком.
      await this.prisma.payslip.update({ where: { id }, data: { adjustmentAmount, adjustmentReason, baseOverride } });
      await this.recalculateCore(await this.loadForAdminMutation(id), actor);
    } else {
      const base = baseOverride ?? existing.baseAmount;
      const { total, needsReview } = this.evaluateTotal(base, existing.bonusAmount, existing.kpiBonusAmount, adjustmentAmount);
      await this.prisma.payslip.update({
        where: { id },
        data: { adjustmentAmount, adjustmentReason, baseOverride, totalAmount: total, needsReview },
      });
    }

    const parts: string[] = [];
    if (dto.adjustmentAmount !== undefined) parts.push(`корректировка ${this.money(adjustmentAmount)} TJS (${adjustmentReason})`);
    if (dto.baseOverride !== undefined) parts.push(`оклад заменён на ${this.money(baseOverride)} TJS (${dto.baseOverrideReason!.trim()})`);
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_ADJUST',
        details: `Правка листа ${existing.user.fullName} за ${existing.periodKey}${parts.length ? ': ' + parts.join('; ') : ''}`,
      })
      .catch(() => undefined);

    return this.refetch(id);
  }

  /**
   * ТЗ 1.1-подобный Double Check для зарплаты: пересчёт ПЕРЕД заморозкой +
   * сверка с суммой, которую видел клиент (аналог updatedAtCheck в
   * payments.service.approve) + запрет самоутверждения.
   *
   * Проверка «ADMIN утверждает только листы EMPLOYEE» ниже с переходом на
   * ТЗ v3 недостижима: утверждение закрыто @Roles(FOUNDER), Администратор
   * до сюда не доходит. Оставлена намеренно как защита в глубину — если
   * классовый @Roles когда-нибудь расширят обратно, запрет сработает сам.
   */
  async approve(id: string, dto: ApprovePayslipDto, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'DRAFT') throw new ConflictException('Утвердить можно только черновик');
    if (existing.userId === actor.id) {
      throw new ConflictException('Нельзя утвердить собственный расчётный лист');
    }
    if (actor.role === Role.ADMIN && existing.user.role !== Role.EMPLOYEE) {
      throw new ForbiddenException('Администратор утверждает только листы менеджеров — лист администратора утверждает Основатель');
    }

    const recalced = await this.recalculateCore(existing, actor);
    if (dto.expectedTotal !== undefined) {
      const expected = new Prisma.Decimal(dto.expectedTotal);
      if (!expected.equals(recalced.totalAmount)) {
        throw new ConflictException(
          `Сумма изменилась с момента открытия карточки: было ${expected.toFixed(2)}, стало ${recalced.totalAmount.toFixed(2)} TJS. Обновите страницу.`,
        );
      }
    }

    const now = new Date();
    const result = await this.prisma.payslip.updateMany({
      where: { id, status: 'DRAFT', deletedAt: null },
      data: { status: 'APPROVED', approvedAt: now, approvedById: actor.id },
    });
    if (result.count === 0) throw new ConflictException('Статус листа изменился, обновите страницу');

    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_APPROVE',
        details: `Утверждено начисление ${existing.user.fullName} за ${existing.periodKey}: ${this.money(recalced.totalAmount)} TJS`,
      })
      .catch(() => undefined);
    this.notifications
      .notifyUser(existing.userId, {
        type: 'PAYROLL_APPROVE',
        title: 'Начисление утверждено',
        message: `За ${existing.periodKey} утверждено ${this.money(recalced.totalAmount)} TJS`,
      })
      .catch(() => undefined);
    this.realtime.emitUser(existing.userId, 'payslip:updated', { payslipId: id });

    return this.refetch(id);
  }

  async recall(id: string, dto: RecallPayslipDto, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'APPROVED') throw new ConflictException('Вернуть в черновик можно только утверждённый лист');
    const reason = dto.reason.trim();
    const result = await this.prisma.payslip.updateMany({
      where: { id, status: 'APPROVED', deletedAt: null },
      data: { status: 'DRAFT', approvedAt: null, approvedById: null },
    });
    if (result.count === 0) throw new ConflictException('Статус листа изменился, обновите страницу');
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RECALL',
        details: `Лист ${existing.user.fullName} за ${existing.periodKey} возвращён в черновик: ${reason}`,
      })
      .catch(() => undefined);
    return this.refetch(id);
  }

  /** ТЗ 1.1: движение денег подтверждает только Основатель — @Roles(FOUNDER) в контроллере. */
  async pay(id: string, dto: PayPayslipDto, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'APPROVED') throw new ConflictException('Выплатить можно только утверждённый лист');
    const now = new Date();
    const result = await this.prisma.payslip.updateMany({
      where: { id, status: 'APPROVED', deletedAt: null },
      data: { status: 'PAID', paidAt: now, paidById: actor.id, paidReference: dto.paidReference?.trim() || null },
    });
    if (result.count === 0) throw new ConflictException('Статус листа изменился, обновите страницу');
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_PAY',
        details: `Выплата зафиксирована: ${existing.user.fullName} за ${existing.periodKey}, ${this.money(existing.totalAmount)} TJS`,
      })
      .catch(() => undefined);
    this.notifications
      .notifyUser(existing.userId, {
        type: 'PAYROLL_PAY',
        title: 'Зарплата выплачена',
        message: `За ${existing.periodKey} выплачено ${this.money(existing.totalAmount)} TJS`,
      })
      .catch(() => undefined);
    this.realtime.emitUser(existing.userId, 'payslip:updated', { payslipId: id });
    return this.refetch(id);
  }

  async voidPayslip(id: string, dto: VoidPayslipDto, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'APPROVED' && existing.status !== 'PAID') {
      throw new ConflictException('Аннулировать можно только утверждённый или выплаченный лист');
    }
    const reason = dto.reason.trim();
    const now = new Date();
    const result = await this.prisma.payslip.updateMany({
      where: { id, status: existing.status, deletedAt: null },
      // paidAt НЕ обнуляется, даже если аннулируется уже выплаченный лист —
      // дата проведения остаётся для аудита (та же семантика, что Payment.approvedAt).
      data: { status: 'VOID', voidedAt: now, voidedById: actor.id, voidReason: reason, activeSlot: null },
    });
    if (result.count === 0) throw new ConflictException('Статус листа изменился, обновите страницу');
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_VOID',
        details: `Аннулирован лист ${existing.user.fullName} за ${existing.periodKey}: ${reason}`,
      })
      .catch(() => undefined);
    this.notifications
      .notifyUser(existing.userId, {
        type: 'PAYROLL_VOID',
        title: 'Расчётный лист аннулирован',
        message: `Лист за ${existing.periodKey} аннулирован. Причина: ${reason}`,
      })
      .catch(() => undefined);
    this.realtime.emitUser(existing.userId, 'payslip:updated', { payslipId: id });
    return this.refetch(id);
  }

  async reissue(id: string, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'VOID') throw new ConflictException('Переиздать можно только аннулированный лист');

    const range: PeriodRange = { key: existing.periodKey, from: existing.periodStart, to: existing.periodEnd };
    const ruleSet = await this.rules.activeSetFor(range.from);
    const calc = await this.buildCalculation({ id: existing.userId, role: existing.user.role }, range, ruleSet as RuleSetWithRules | null);
    const { total, needsReview } = this.evaluateTotal(calc.baseAmount, calc.bonusAmount, calc.kpiBonusAmount, new Prisma.Decimal(0));

    const maxRevision = await this.prisma.payslip.aggregate({
      where: { userId: existing.userId, periodKey: existing.periodKey },
      _max: { revision: true },
    });
    const nextRevision = (maxRevision._max.revision ?? existing.revision) + 1;

    const created = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.payslip.create({
        data: {
          userId: existing.userId,
          periodStart: range.from,
          periodEnd: range.to,
          periodKey: range.key,
          revision: nextRevision,
          activeSlot: 'ACTIVE',
          status: 'DRAFT',
          baseAmount: calc.baseAmount,
          bonusAmount: calc.bonusAmount,
          kpiBonusAmount: calc.kpiBonusAmount,
          totalAmount: total,
          needsReview,
          ruleSetId: ruleSet?.id ?? null,
          ruleSetVersion: ruleSet?.version ?? null,
          formulaSnapshot: this.snapshotFormula(ruleSet as RuleSetWithRules | null, existing.userId) as unknown as Prisma.InputJsonValue,
          metricsSnapshot: this.snapshotMetrics(calc.metrics) as unknown as Prisma.InputJsonValue,
          breakdown: calc.breakdown as unknown as Prisma.InputJsonValue,
          leadsProcessed: calc.metrics.leadsProcessed,
          consultationsHeld: calc.metrics.consultationsHeld,
          contractsSigned: calc.metrics.contractsSigned,
          enrolledCount: calc.metrics.enrolledCount,
          relocatedCount: calc.metrics.relocatedCount,
          conversionRate: calc.metrics.conversionRate,
          timelinessRate: calc.metrics.timelinessRate,
          deliveryRate: calc.metrics.deliveryRate,
          calculatedAt: new Date(),
          calculatedById: actor.id,
        },
      });
      await tx.payslip.update({ where: { id: existing.id }, data: { replacedById: fresh.id } });
      return fresh;
    });

    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_REISSUE',
        details: `Переиздан лист ${existing.user.fullName} за ${existing.periodKey}, ревизия ${nextRevision}`,
      })
      .catch(() => undefined);
    return this.refetch(created.id);
  }

  async remove(id: string, actor: CurrentUser) {
    const existing = await this.loadForAdminMutation(id);
    if (existing.status !== 'DRAFT') throw new ConflictException('Удалить можно только черновик');
    await this.prisma.payslip.update({ where: { id }, data: { deletedAt: new Date(), activeSlot: null } });
    this.activity
      .log({ actorId: actor.id, actorRole: actor.role, action: 'PAYROLL_DRAFT_DELETE', details: `Черновик листа ${existing.user.fullName} за ${existing.periodKey} удалён` })
      .catch(() => undefined);
    return { ok: true };
  }

  /** GET /payroll/rules/sets/:id/simulate — применяет ЧЕРНОВИК к периоду, ничего не пишет. */
  async simulate(ruleSetId: string, periodKey: string) {
    const range = periodRangeFromKey(periodKey);
    const ruleSet = await this.prisma.bonusRuleSet.findFirst({
      where: { id: ruleSetId, deletedAt: null },
      include: { rules: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!ruleSet) throw new NotFoundException('Набор правил не найден');

    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, role: { in: [Role.EMPLOYEE, Role.ADMIN] } },
      select: { id: true, role: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    const currentRuleSet = await this.rules.activeSetFor(range.from);

    const items: Array<{ userId: string; fullName: string; before: string; after: string; diff: string }> = [];
    for (const u of users) {
      const before = await this.buildCalculation(u, range, currentRuleSet as RuleSetWithRules | null);
      const after = await this.buildCalculation(u, range, ruleSet);
      const beforeTotal = this.evaluateTotal(before.baseAmount, before.bonusAmount, before.kpiBonusAmount, new Prisma.Decimal(0)).total;
      const afterTotal = this.evaluateTotal(after.baseAmount, after.bonusAmount, after.kpiBonusAmount, new Prisma.Decimal(0)).total;
      items.push({
        userId: u.id,
        fullName: u.fullName,
        before: this.money(beforeTotal),
        after: this.money(afterTotal),
        diff: this.money(afterTotal.minus(beforeTotal)),
      });
    }
    return { period: range.key, ruleSetVersion: ruleSet.version, items };
  }
}
