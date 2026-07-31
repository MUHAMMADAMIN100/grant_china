import { BonusMetricScope, BonusRuleKind, BonusRuleScope, KpiMetric, PaymentStage, Prisma } from '@prisma/client';
import { ManagerPeriodMetrics } from './kpi.service';

/**
 * Раздел 5 ТЗ (волна 6) — движок расчёта бонусов. ЧИСТАЯ ФУНКЦИЯ:
 * (правила, метрики) => расшифровка + суммы. НИКАКОГО eval/new Function/vm/
 * шаблонизаторов — формула это ЗАКРЫТЫЙ список типов (BonusRuleKind) с
 * числовыми параметрами, обрабатывается обычным switch. Строки (label)
 * участвуют ТОЛЬКО как подписи и никогда не интерпретируются как код.
 *
 * На вход — уже ОТФИЛЬТРОВАННЫЙ для конкретного сотрудника список правил
 * (scope=ALL + его личные scope=USER, см. rules.service.ts). Здесь только
 * арифметика.
 */

export interface BonusRuleConfig {
  id: string;
  kind: BonusRuleKind;
  label: string;
  scope: BonusRuleScope;
  userId: string | null;
  rate: Prisma.Decimal | null;
  amount: Prisma.Decimal | null;
  threshold: Prisma.Decimal | null;
  cap: Prisma.Decimal | null;
  stage: PaymentStage | null;
  metric: KpiMetric | null;
  metricScope: BonusMetricScope;
  tierGroup: string | null;
  enabled: boolean;
  sortOrder: number;
}

export interface BonusLine {
  ruleId: string;
  kind: BonusRuleKind;
  label: string;
  /** Человекочитаемая база расчёта — то, что видит сотрудник в расшифровке. */
  base: string;
  /** Итоговая сумма строки, УЖЕ округлённая до 2 знаков (ROUND_HALF_UP). */
  amount: string;
  bucket: 'bonus' | 'kpi';
}

export interface BonusEngineInput {
  /** Оклад периода (baseOverride ?? baseSalary) — база для KPI_THRESHOLD_BONUS(rate). */
  baseAmount: Prisma.Decimal;
  personalMetrics: ManagerPeriodMetrics;
  /** Нужны, только если среди правил есть metricScope=TEAM. */
  teamMetrics: ManagerPeriodMetrics | null;
  /** Предвычислено вызывающей стороной ТОЛЬКО для стадий, реально упомянутых в FIXED_PER_STAGE. */
  closedStagesByStage: Partial<Record<PaymentStage, number>>;
}

export interface BonusEngineResult {
  bonusAmount: Prisma.Decimal;
  kpiBonusAmount: Prisma.Decimal;
  breakdown: BonusLine[];
}

const ZERO = new Prisma.Decimal(0);

function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function applyCap(amount: Prisma.Decimal, cap: Prisma.Decimal | null): Prisma.Decimal {
  if (!cap) return amount;
  return amount.greaterThan(cap) ? cap : amount;
}

export function metricValue(metric: KpiMetric, m: ManagerPeriodMetrics): Prisma.Decimal | null {
  switch (metric) {
    case 'LEADS_PROCESSED':
      return new Prisma.Decimal(m.leadsProcessed);
    case 'CONSULTATIONS_HELD':
      return new Prisma.Decimal(m.consultationsHeld);
    case 'CONTRACTS_SIGNED':
      return new Prisma.Decimal(m.contractsSigned);
    case 'ENROLLED_COUNT':
      return new Prisma.Decimal(m.enrolledCount);
    case 'RELOCATED_COUNT':
      return new Prisma.Decimal(m.relocatedCount);
    case 'CONVERSION_RATE':
      return m.conversionRate;
    case 'PAYMENT_TIMELINESS':
      return m.timelinessRate;
    case 'DELIVERY_RATE':
      return m.deliveryRate;
    default:
      return null;
  }
}

const KPI_METRIC_LABEL: Record<KpiMetric, string> = {
  LEADS_PROCESSED: 'обработанные лиды',
  CONSULTATIONS_HELD: 'консультации',
  CONTRACTS_SIGNED: 'подписанные договоры',
  CONVERSION_RATE: 'конверсия в договор',
  PAYMENT_TIMELINESS: 'своевременность оплат',
  DELIVERY_RATE: 'доведение до зачисления',
  ENROLLED_COUNT: 'зачислено',
  RELOCATED_COUNT: 'переехало',
};

/** Строка для не-пороговых правил (kind 1-7). Возвращает null, если правило неприменимо (нет обязательных параметров). */
function computeSimpleLine(rule: BonusRuleConfig, m: ManagerPeriodMetrics, closedStages: Partial<Record<PaymentStage, number>>): { raw: Prisma.Decimal; base: string } | null {
  switch (rule.kind) {
    case 'PERCENT_OF_CONTRACTS': {
      if (!rule.rate) return null;
      const base = m.contractsAmount;
      return { raw: base.times(rule.rate), base: `${base.toFixed(2)} TJS × ${rule.rate.times(100).toFixed(2)}%` };
    }
    case 'PERCENT_OF_PAYMENTS': {
      if (!rule.rate) return null;
      const base = rule.stage ? m.paymentsAmountByStage[rule.stage] ?? ZERO : m.paymentsAmountTotal;
      return { raw: base.times(rule.rate), base: `${base.toFixed(2)} TJS × ${rule.rate.times(100).toFixed(2)}%` };
    }
    case 'FIXED_PER_CONTRACT': {
      if (!rule.amount) return null;
      return { raw: rule.amount.times(m.contractsSigned), base: `${m.contractsSigned} × ${rule.amount.toFixed(2)} TJS` };
    }
    case 'FIXED_PER_STAGE': {
      if (!rule.amount || !rule.stage) return null;
      const count = closedStages[rule.stage] ?? 0;
      return { raw: rule.amount.times(count), base: `${count} × ${rule.amount.toFixed(2)} TJS` };
    }
    case 'FIXED_PER_ENROLLMENT': {
      if (!rule.amount) return null;
      return { raw: rule.amount.times(m.enrolledCount), base: `${m.enrolledCount} × ${rule.amount.toFixed(2)} TJS` };
    }
    case 'FIXED_PER_RELOCATION': {
      if (!rule.amount) return null;
      return { raw: rule.amount.times(m.relocatedCount), base: `${m.relocatedCount} × ${rule.amount.toFixed(2)} TJS` };
    }
    case 'FIXED_PER_CONSULTATION': {
      if (!rule.amount) return null;
      return { raw: rule.amount.times(m.consultationsHeld), base: `${m.consultationsHeld} × ${rule.amount.toFixed(2)} TJS` };
    }
    default:
      return null;
  }
}

export function calculateBonus(rules: BonusRuleConfig[], input: BonusEngineInput): BonusEngineResult {
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => a.sortOrder - b.sortOrder);

  let bonusAmount = ZERO;
  let kpiBonusAmount = ZERO;
  const breakdown: BonusLine[] = [];

  // ── Правила 1–7: суммируются независимо, каждое своим потолком (cap). ──
  for (const rule of enabled) {
    if (rule.kind === 'KPI_THRESHOLD_BONUS') continue;
    const computed = computeSimpleLine(rule, input.personalMetrics, input.closedStagesByStage);
    if (!computed || computed.raw.lessThanOrEqualTo(0)) continue;
    const capped = applyCap(computed.raw, rule.cap);
    const amount = round2(capped);
    if (amount.lessThanOrEqualTo(0)) continue;
    bonusAmount = bonusAmount.plus(amount);
    breakdown.push({ ruleId: rule.id, kind: rule.kind, label: rule.label, base: computed.base, amount: amount.toFixed(2), bucket: 'bonus' });
  }

  // ── KPI_THRESHOLD_BONUS: сгруппированы по tierGroup (ступенчатая шкала). ──
  // Правила БЕЗ tierGroup — независимые (группа = собственный id, ни с кем не конкурирует).
  const tierGroups = new Map<string, BonusRuleConfig[]>();
  for (const rule of enabled) {
    if (rule.kind !== 'KPI_THRESHOLD_BONUS') continue;
    const key = rule.tierGroup ?? `__solo__:${rule.id}`;
    const list = tierGroups.get(key) ?? [];
    list.push(rule);
    tierGroups.set(key, list);
  }

  for (const [, group] of tierGroups) {
    let best: { rule: BonusRuleConfig; value: Prisma.Decimal } | null = null;
    for (const rule of group) {
      if (!rule.metric || !rule.threshold) continue;
      const source = rule.metricScope === 'TEAM' ? input.teamMetrics : input.personalMetrics;
      if (!source) continue;
      const value = metricValue(rule.metric, source);
      if (value === null) continue; // «нет базы» — правило не применимо, а не провалено
      if (value.lessThan(rule.threshold)) continue;
      // Среди пройденных порогов одной группы — наибольший threshold (ступень выше).
      if (!best || rule.threshold.greaterThan(best.rule.threshold as Prisma.Decimal)) {
        best = { rule, value };
      }
    }
    if (!best) continue;
    const { rule, value } = best;
    const raw = rule.amount ?? (rule.rate ? input.baseAmount.times(rule.rate) : null);
    if (!raw || raw.lessThanOrEqualTo(0)) continue;
    const amount = round2(raw);
    if (amount.lessThanOrEqualTo(0)) continue;
    kpiBonusAmount = kpiBonusAmount.plus(amount);
    const metricLabel = KPI_METRIC_LABEL[rule.metric as KpiMetric];
    // ВАЖНО (accessModel проекта архитектора, k-анонимность): breakdown этой
    // строки уходит В ЭТОМ ЖЕ ВИДЕ сотруднику (preview/payslip — свои данные,
    // 404 для чужих). Для metricScope=PERSONAL точное число — его собственное,
    // раскрывать нечего. Для TEAM — точное число агрегата по отделу НЕЛЬЗЯ
    // печатать здесь ни при каком размере команды: k-анонимность проверяется
    // ТОЛЬКО в payslips.service.kpiForMe() для отдельного «командного» виджета
    // (там она либо есть, либо скрыта целиком), а расшифровка бонуса — второй,
    // независимый канал, который эту проверку не проходит. Печатаем только
    // факт «порог пройден», без чисел.
    const base =
      rule.metricScope === 'TEAM'
        ? `${metricLabel} (командный показатель): порог пройден`
        : `${metricLabel} (лично): ${value.toFixed(4)} ≥ ${(rule.threshold as Prisma.Decimal).toFixed(4)}`;
    breakdown.push({
      ruleId: rule.id,
      kind: rule.kind,
      label: rule.label,
      base,
      amount: amount.toFixed(2),
      bucket: 'kpi',
    });
  }

  return { bonusAmount, kpiBonusAmount, breakdown };
}
