import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ConsultationKind, ConsultationOutcome, Direction } from '@prisma/client';
import { LEAD_SOURCE_VALUES } from '../../common/lead-source';

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export class UpdateConsultationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_RE, { message: 'phone должен содержать только цифры' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  purpose?: string;

  @IsOptional()
  @IsEnum(ConsultationKind)
  kind?: ConsultationKind;

  @IsOptional()
  @IsIn(LEAD_SOURCE_VALUES)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;

  @IsOptional()
  @IsEnum(Direction)
  direction?: Direction;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsISO8601()
  heldAt?: string;

  // «Решение клиента» — фиксируется ПОСЛЕ повторного звонка (ТЗ 3.2).
  @IsOptional()
  @IsEnum(ConsultationOutcome)
  outcome?: ConsultationOutcome;

  // string | null: перенос даты (string) либо отмена повторного звонка
  // (null) — оба случая пересинхронизируют автозадачу, см. сервис.
  @IsOptional()
  @IsISO8601()
  followUpAt?: string | null;

  // Ручная привязка к уже существующей заявке/студенту (см. consultationModel
  // проекта архитектора — «Ручная привязка»).
  @IsOptional()
  @IsString()
  applicationId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  managerId?: string;
}
