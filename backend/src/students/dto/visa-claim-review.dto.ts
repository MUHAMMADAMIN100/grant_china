import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Отклонение отметки о визе, поданной студентом (26.08.2026). Причина
 * обязательна: студент видит её в кабинете, и без объяснения он просто
 * нажмёт кнопку ещё раз.
 */
export class RejectVisaClaimDto {
  @IsString()
  @MinLength(5, { message: 'Укажите причину (минимум 5 символов)' })
  @MaxLength(2000)
  reason: string;
}
