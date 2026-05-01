import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApplicationStatus, Direction } from '@prisma/client';

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
}
