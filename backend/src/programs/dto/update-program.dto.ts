import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Direction } from '@prisma/client';

export class UpdateProgramDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) university?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) major?: string;
  @IsOptional() @IsEnum(Direction) direction?: Direction;
  @IsOptional() @IsNumber() cost?: number;
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsString() @MaxLength(80) duration?: string;
  @IsOptional() @IsString() @MaxLength(80) language?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(400) imageUrl?: string;
  @IsOptional() @IsBoolean() published?: boolean;
}
