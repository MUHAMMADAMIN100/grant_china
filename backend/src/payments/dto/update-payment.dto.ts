import { IsEnum, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PaymentMethod, PaymentPurpose, PaymentStage } from '@prisma/client';
import { AMOUNT_RE } from './create-payment.dto';

/**
 * Правка возможна ТОЛЬКО пока платёж в DRAFT/REJECTED (см. statusMachine
 * проекта архитектора) — PENDING_APPROVAL/APPROVED/VOID редактированию не
 * подлежат ни через этот DTO, ни как-либо ещё. Поле status сюда намеренно
 * не входит — смена статуса только через выделенные эндпоинты
 * (submit/recall/approve/reject/void), каждый со своей проверкой прав.
 *
 * Проблема 8 аудита волны 1: @IsOptional() у class-validator пропускает БЕЗ
 * проверки и undefined (поле не передали), и null (поле передали пустым).
 * Сервис (payments.service.ts update()) применяет только явно переданные
 * поля через `dto.X !== undefined` — то есть `{ paidAt: null }` проходил
 * валидацию, `new Date(null)` тихо давал 1970-01-01, и вся отчётность «за
 * период» (она строится по paidAt) съезжала на эпоху. stage/purpose/method/
 * amount/paidAt — НЕ nullable колонки в БД (см. schema.prisma), поэтому null
 * там всегда ошибка ввода, а не «очистить поле». Ниже вместо @IsOptional()
 * используется @ValidateIf(o => o.X !== undefined): undefined — поле
 * пропускается целиком (как раньше), null — доходит до валидатора (IsEnum/
 * Matches/IsString) и получает 400, а не тихо портит данные.
 * reference/comment — ИСКЛЮЧЕНИЕ: null там осмыслен («очистить поле»,
 * ровно так работает текущий код сервиса), поэтому у них @IsOptional()
 * оставлен как есть.
 */
export class UpdatePaymentDto {
  @ValidateIf((o) => o.stage !== undefined)
  @IsEnum(PaymentStage)
  stage?: PaymentStage;

  @ValidateIf((o) => o.purpose !== undefined)
  @IsEnum(PaymentPurpose)
  purpose?: PaymentPurpose;

  @ValidateIf((o) => o.method !== undefined)
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ValidateIf((o) => o.amount !== undefined)
  @Matches(AMOUNT_RE, { message: 'Сумма должна быть положительным числом (до двух знаков после точки)' })
  amount?: string;

  /**
   * Разбивка смешанной оплаты. null осмыслен («очистить разбивку» при смене
   * способа с MIXED на обычный), поэтому @IsOptional, а не @ValidateIf —
   * инвариант целиком проверяет payment-rules.normalizeMethodParts по
   * ИТОГОВОМУ состоянию платежа (после мёржа с существующими значениями).
   */
  @IsOptional()
  @ValidateIf((o) => o.cashAmount !== undefined && o.cashAmount !== null)
  @Matches(AMOUNT_RE, { message: 'Наличная часть должна быть положительным числом (до двух знаков после точки)' })
  cashAmount?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.cashlessAmount !== undefined && o.cashlessAmount !== null)
  @Matches(AMOUNT_RE, { message: 'Безналичная часть должна быть положительным числом (до двух знаков после точки)' })
  cashlessAmount?: string | null;

  @ValidateIf((o) => o.paidAt !== undefined)
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
}
