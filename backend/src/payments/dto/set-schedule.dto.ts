import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaymentStage } from '@prisma/client';
import { AMOUNT_RE } from './create-payment.dto';

/**
 * PUT /payments/schedule — задаёт индивидуальную плановую сумму/срок этапа
 * договора (upsert по @@unique([studentId, stage])). LIVING_EXPENSES сюда
 * не годится — у расходов на месте нет плана (проверяется в сервисе).
 */
export class SetScheduleDto {
  @IsString()
  studentId: string;

  @IsEnum(PaymentStage)
  stage: PaymentStage;

  // 0 разрешён явно ("сумма ещё не согласована") — @Matches не отбрасывает '0'.
  @Matches(AMOUNT_RE, { message: 'Плановая сумма должна быть числом (до двух знаков после точки)' })
  plannedAmount: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
