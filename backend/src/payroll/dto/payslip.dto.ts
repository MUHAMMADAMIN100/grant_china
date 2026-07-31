import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const AMOUNT_RE = /^-?\d{1,10}(\.\d{1,2})?$/; // корректировка МОЖЕТ быть отрицательной

export class GeneratePayslipsDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'period должен быть в формате YYYY-MM' })
  period: string;
}

export class CreatePayslipDto {
  @IsString()
  userId: string;

  @Matches(/^\d{4}-\d{2}$/, { message: 'period должен быть в формате YYYY-MM' })
  period: string;
}

export class UpdatePayslipDto {
  @IsOptional()
  @Matches(AMOUNT_RE, { message: 'adjustmentAmount должен быть числом (до двух знаков после точки)' })
  adjustmentAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adjustmentReason?: string;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'baseOverride должен быть положительным числом' })
  baseOverride?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  baseOverrideReason?: string;
}

export class ApprovePayslipDto {
  /** Сумма totalAmount, которую видел клиент при открытии карточки — та же optimistic-concurrency проверка, что у Payment.approve(). */
  @IsOptional()
  @IsString()
  expectedTotal?: string;
}

export class RecallPayslipDto {
  @IsString()
  @MinLength(5, { message: 'Укажите причину возврата в черновик (минимум 5 символов)' })
  @MaxLength(2000)
  reason: string;
}

export class PayPayslipDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paidReference?: string;
}

export class VoidPayslipDto {
  @IsString()
  @MinLength(5, { message: 'Укажите причину аннулирования (минимум 5 символов)' })
  @MaxLength(2000)
  reason: string;
}
