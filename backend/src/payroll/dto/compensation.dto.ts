import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Тот же формат, что у Payment.amount (AMOUNT_RE в payments/dto/create-payment.dto.ts).
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;
// Тот же формат, что <input type="date"> — БЕЗ времени (см. grants/grant-year.ts).
const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** POST /payroll/compensation — только FOUNDER (ТЗ 2.8, «кадровые ведомости»). */
export class SetCompensationDto {
  @IsString()
  userId: string;

  @Matches(AMOUNT_RE, { message: 'Оклад должен быть положительным числом (до двух знаков после точки)' })
  baseSalary: string;

  @Matches(CALENDAR_DATE_RE, { message: 'effectiveFrom должен быть в формате YYYY-MM-DD' })
  effectiveFrom: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
