import { IsBoolean, IsEnum, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, MinLength } from 'class-validator';
import { Direction } from '@prisma/client';
import { COST_LABEL, MAX_PROGRAM_PRICE, SEMESTER_COST_LABEL } from '../program-price';

export class CreateProgramDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  university: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  major: string;

  @IsEnum(Direction)
  direction: Direction;

  // Цены (04.11.2026): за год и/или за 1 семестр, хотя бы одна — см. program-price.ts.
  // POST /programs собирает DTO вручную из multipart (controller.create,
  // parsePriceInput), декораторы здесь — для единообразия с UpdateProgramDto.
  @IsOptional()
  @IsNumber({}, { message: `${COST_LABEL} должна быть числом` })
  @IsPositive({ message: `${COST_LABEL} должна быть больше 0` })
  @Max(MAX_PROGRAM_PRICE, { message: `${COST_LABEL} — не больше 10 000 000` })
  cost?: number | null;

  @IsOptional()
  @IsNumber({}, { message: `${SEMESTER_COST_LABEL} должна быть числом` })
  @IsPositive({ message: `${SEMESTER_COST_LABEL} должна быть больше 0` })
  @Max(MAX_PROGRAM_PRICE, { message: `${SEMESTER_COST_LABEL} — не больше 10 000 000` })
  semesterCost?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  duration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
