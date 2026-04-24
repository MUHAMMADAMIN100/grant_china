import { IsEmail, IsEnum, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { Direction } from '@prisma/client';

export class CreateApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MinLength(5)
  @MaxLength(40)
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(Direction)
  direction: Direction;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsString()
  programId?: string;
}
