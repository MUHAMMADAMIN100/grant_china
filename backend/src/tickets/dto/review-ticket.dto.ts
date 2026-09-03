import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Отклонение билета, поданного студентом (26.08.2026). Причина обязательна и
 * не короче 5 символов — тот же порог, что у RejectPaymentDto: студент видит
 * её в кабинете, и «нет» вместо объяснения оставит его гадать, что исправить.
 */
export class RejectTicketDto {
  @IsString()
  @MinLength(5, { message: 'Укажите причину отклонения (минимум 5 символов)' })
  @MaxLength(2000)
  reason: string;
}
