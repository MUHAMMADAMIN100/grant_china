import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApplicationStatus, Direction } from '@prisma/client';

export class UpdateApplicationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsEnum(Direction)
  direction?: Direction;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
