import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaymentMethod, PaymentPurpose, PaymentStage } from '@prisma/client';

// Запрос multipart/form-data (файл чека + поля в одном запросе) — все
// значения приходят строками, даже если по смыслу число/дата/boolean.
// До 10 цифр целой части (Decimal(12,2) в схеме — максимум 9 999 999 999.99).
export const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;

export class CreatePaymentDto {
  @IsString()
  studentId: string;

  @IsEnum(PaymentStage)
  stage: PaymentStage;

  @IsEnum(PaymentPurpose)
  purpose: PaymentPurpose;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @Matches(AMOUNT_RE, { message: 'Сумма должна быть положительным числом (до двух знаков после точки)' })
  amount: string;

  /** Дата фактического поступления денег. Если не передана — берётся текущий момент. */
  @IsOptional()
  @IsString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  /**
   * multipart всегда передаёт строку 'true'/'false', не boolean —
   * class-validator/class-transformer здесь не приводит тип автоматически
   * (ValidationPipe в main.ts без enableImplicitConversion), поэтому сервис
   * сравнивает буквально с 'true'.
   */
  @IsOptional()
  @IsString()
  submit?: string;
}

export class RejectPaymentDto {
  @IsString()
  @MinLength(5, { message: 'Укажите причину отклонения (минимум 5 символов)' })
  @MaxLength(2000)
  reason: string;
}

export class VoidPaymentDto {
  @IsString()
  @MinLength(5, { message: 'Укажите причину аннулирования (минимум 5 символов)' })
  @MaxLength(2000)
  reason: string;
}

export class ApprovePaymentDto {
  /**
   * ISO-строка Payment.updatedAt, которую клиент видел при открытии карточки —
   * optimistic-concurrency check: если платёж успели изменить, approve не
   * пройдёт (см. payments.service.ts approve()).
   */
  @IsOptional()
  @IsString()
  updatedAt?: string;
}
