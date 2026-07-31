import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { GrantStatus } from '@prisma/client';

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class UpdateGrantDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  university?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  totalYears?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  currentYear?: number;

  @IsOptional()
  @Matches(CALENDAR_DATE_RE, { message: 'startDate должен быть в формате YYYY-MM-DD' })
  startDate?: string;

  // null — явная очистка (грант больше не продлевается и не ждёт
  // следующего года); string — перенос плановой даты вузом.
  @IsOptional()
  @Matches(CALENDAR_DATE_RE, { message: 'nextYearStartsAt должен быть в формате YYYY-MM-DD' })
  nextYearStartsAt?: string | null;

  @IsOptional()
  @IsEnum(GrantStatus)
  status?: GrantStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
