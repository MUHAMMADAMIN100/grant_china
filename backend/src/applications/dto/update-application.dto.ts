import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApplicationStatus, Direction } from '@prisma/client';
import { LEAD_SOURCE_VALUES } from '../../common/lead-source';

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export class UpdateApplicationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

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
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsEnum(Direction)
  direction?: Direction;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  // Раздел 3.1 ТЗ — карточка заявки позволяет проставить/поправить источник
  // вручную (например для 229 исторических заявок с source = null).
  @IsOptional()
  @IsIn(LEAD_SOURCE_VALUES)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;
}
