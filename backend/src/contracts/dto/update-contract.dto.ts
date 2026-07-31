import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AMOUNT_RE } from '../../payments/dto/create-payment.dto';

/**
 * Поля amount/applicationId/managerId заморожены после подписания для всех,
 * кроме FOUNDER (см. schema.prisma, комментарий к Contract) — проверяется
 * в сервисе, не здесь. note остаётся доступным обычным менеджерам всегда.
 */
export class UpdateContractDto {
  @IsOptional()
  @Matches(AMOUNT_RE, { message: 'Сумма должна быть числом (до двух знаков после точки)' })
  amount?: string;

  @IsOptional()
  @IsString()
  applicationId?: string | null;

  @IsOptional()
  @IsString()
  managerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class SignContractDto {
  /** 'YYYY-MM-DD'. Если не передано — сегодня. Не может быть в будущем (проверяется в сервисе). */
  @IsOptional()
  @IsString()
  signedAt?: string;
}

export class TerminateContractDto {
  @IsString()
  @MinLength(5, { message: 'Укажите причину расторжения (минимум 5 символов)' })
  @MaxLength(2000)
  reason: string;
}
