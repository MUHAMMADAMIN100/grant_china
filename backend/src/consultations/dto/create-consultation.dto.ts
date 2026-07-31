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
import { ConsultationKind, Direction } from '@prisma/client';
import { LEAD_SOURCE_VALUES } from '../../common/lead-source';

// Тот же формат, что и у заявок (applications/dto/create-application.dto.ts).
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export class CreateConsultationDto {
  // ТЗ 3.2 — три обязательных поля: ФИО, номер телефона, цель обращения.
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MinLength(5)
  @MaxLength(40)
  @Matches(PHONE_RE, { message: 'phone должен содержать только цифры (с опциональным «+» и пробелами/дефисами)' })
  phone: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  purpose: string;

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

  // Когда консультация ФАКТИЧЕСКИ проведена — не обязательно «сейчас»
  // (менеджер вносит вчерашнюю встречу сегодня). По умолчанию — текущий момент.
  @IsOptional()
  @IsISO8601()
  heldAt?: string;

  // ТЗ 3.2 — дата и время повторного звонка. Если указана — синхронно
  // создаётся задача (см. consultations.service.ts create()).
  @IsOptional()
  @IsISO8601()
  followUpAt?: string;

  @IsOptional()
  @IsString()
  applicationId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  // По умолчанию — сам автор записи. Назначить консультацию ДРУГОМУ
  // менеджеру может только FOUNDER/ADMIN (проверка в сервисе — значение
  // зависит от тела запроса, а не от одной лишь роли).
  @IsOptional()
  @IsString()
  managerId?: string;
}
