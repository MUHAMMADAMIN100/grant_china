import { IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { Direction, StudentStatus } from '@prisma/client';

export class CreateStudentDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phones?: string[];

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsEnum(Direction)
  direction: Direction;

  @IsOptional()
  @IsInt()
  cabinet?: number;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}
