import { IsArray, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Direction, StudentStatus } from '@prisma/client';
import { LEAD_SOURCE_VALUES } from '../../common/lead-source';

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export class CreateStudentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(PHONE_RE, { each: true, message: 'каждый phone должен содержать только цифры' })
  phones?: string[];

  @IsEmail()
  @MaxLength(120)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @IsEnum(Direction)
  direction: Direction;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  cabinet?: number;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  // Раздел 3.1 ТЗ — источник привлечения. Заводится ЗДЕСЬ, а не только на
  // публичной форме лендинга: студент, заведённый вручную, тоже создаёт
  // заявку (см. students.service.create), и без этого поля она навсегда
  // оставалась бы «Источник не указан» — то есть выпадала из ровно того
  // отчёта по каналам, ради которого раздел 3.1 и делался.
  // Значение по умолчанию сервер НЕ подставляет: выдуманный факт («Сайт»
  // для человека, пришедшего в офис) хуже честного «не указан».
  @IsOptional()
  @IsIn(LEAD_SOURCE_VALUES)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;
}
