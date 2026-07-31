import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Тот же формат, что принимает <input type="date"> — БЕЗ времени намеренно (см. grant-year.ts). */
const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateGrantDto {
  @IsString()
  @MinLength(1)
  studentId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  university?: string;

  // Сколько лет покрывает грант. 8 — с запасом (языковой год + бакалавриат +
  // магистратура), а не гарантированный максимум.
  @IsInt()
  @Min(1)
  @Max(8)
  totalYears: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  currentYear?: number;

  @Matches(CALENDAR_DATE_RE, { message: 'startDate должен быть в формате YYYY-MM-DD' })
  startDate: string;

  @IsOptional()
  @Matches(CALENDAR_DATE_RE, { message: 'nextYearStartsAt должен быть в формате YYYY-MM-DD' })
  nextYearStartsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
