import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { BonusMetricScope, BonusRuleKind, BonusRuleScope, KpiMetric, PaymentStage } from '@prisma/client';

/**
 * Раздел 5 ТЗ (волна 6) — «изменение формул бонусов» как выбор ТИПА из
 * закрытого списка (BonusRuleKind) + числовые параметры. Поля для текста
 * формулы ЗДЕСЬ НЕТ И НЕ ПОЯВИТСЯ — это архитектурный запрет на выполнение
 * произвольного кода (см. formulaConfig проекта архитектора).
 */

// rate — ДОЛЯ 0..1 (0.0300 = 3%), до 4 знаков после точки.
const RATE_RE = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/;
// amount/cap — сумма TJS, как Payment.amount.
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
// threshold — счётчик (0..10000) либо доля (0..1), до 4 знаков.
const THRESHOLD_RE = /^\d{1,10}(\.\d{1,4})?$/;

export class CreateBonusRuleDto {
  @IsEnum(BonusRuleKind)
  kind: BonusRuleKind;

  @IsString()
  @MaxLength(200)
  label: string;

  @IsOptional()
  @IsEnum(BonusRuleScope)
  scope?: BonusRuleScope;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Matches(RATE_RE, { message: 'rate должен быть долей от 0 до 1 (до 4 знаков после точки)' })
  rate?: string;

  @IsOptional()
  @Matches(MONEY_RE, { message: 'amount должен быть положительным числом (до двух знаков после точки)' })
  amount?: string;

  @IsOptional()
  @Matches(THRESHOLD_RE, { message: 'threshold должен быть неотрицательным числом' })
  threshold?: string;

  @IsOptional()
  @Matches(MONEY_RE, { message: 'cap должен быть положительным числом' })
  cap?: string;

  @IsOptional()
  @IsEnum(PaymentStage)
  stage?: PaymentStage;

  @IsOptional()
  @IsEnum(KpiMetric)
  metric?: KpiMetric;

  @IsOptional()
  @IsEnum(BonusMetricScope)
  metricScope?: BonusMetricScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tierGroup?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/**
 * PATCH правила — тот же приём, что UpdatePaymentDto: @ValidateIf вместо
 * @IsOptional для полей, где null должен явно провалить валидацию (это не
 * nullable-очистка, а ошибка ввода), кроме полей, которые осмысленно можно
 * обнулить (userId/stage/metric/tierGroup/note — см. сервис).
 */
export class UpdateBonusRuleDto {
  @ValidateIf((o) => o.kind !== undefined)
  @IsEnum(BonusRuleKind)
  kind?: BonusRuleKind;

  @ValidateIf((o) => o.label !== undefined)
  @IsString()
  @MaxLength(200)
  label?: string;

  @ValidateIf((o) => o.scope !== undefined)
  @IsEnum(BonusRuleScope)
  scope?: BonusRuleScope;

  @IsOptional()
  @IsString()
  userId?: string | null;

  @IsOptional()
  @Matches(RATE_RE, { message: 'rate должен быть долей от 0 до 1 (до 4 знаков после точки)' })
  rate?: string | null;

  @IsOptional()
  @Matches(MONEY_RE, { message: 'amount должен быть положительным числом' })
  amount?: string | null;

  @IsOptional()
  @Matches(THRESHOLD_RE, { message: 'threshold должен быть неотрицательным числом' })
  threshold?: string | null;

  @IsOptional()
  @Matches(MONEY_RE, { message: 'cap должен быть положительным числом' })
  cap?: string | null;

  @IsOptional()
  @IsEnum(PaymentStage)
  stage?: PaymentStage | null;

  @IsOptional()
  @IsEnum(KpiMetric)
  metric?: KpiMetric | null;

  @IsOptional()
  @IsEnum(BonusMetricScope)
  metricScope?: BonusMetricScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tierGroup?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class CreateBonusRuleSetDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveFrom должен быть в формате YYYY-MM-DD' })
  effectiveFrom: string;

  /** Клонировать правила из существующего набора (обычно ACTIVE) — обычный сценарий «изменить формулы». */
  @IsOptional()
  @IsString()
  cloneFromId?: string;
}

export class UpdateBonusRuleSetDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveFrom должен быть в формате YYYY-MM-DD' })
  effectiveFrom?: string;
}
