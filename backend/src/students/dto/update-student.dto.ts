import { IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Direction, StudentStatus } from '@prisma/client';

const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(PHONE_RE, { each: true, message: 'каждый phone должен содержать только цифры' })
  phones?: string[];

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @IsOptional()
  @IsEnum(Direction)
  direction?: Direction;

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

  // Раздел 5 ТЗ — переключатель «Виза получена: Да / Нет» в карточке студента.
  // Необязательное: PATCH из карточки шлёт только это одно поле (переключатель
  // сохраняется сразу, а не вместе со всей формой), и наоборот — обычное
  // сохранение формы не должно случайно сбрасывать отметку о визе.
  // Даты здесь нет намеренно: visaReceivedAt проставляет сервер (см.
  // students.service.update), менеджер её не вводит и подделать не может.
  @IsOptional()
  @IsBoolean()
  visaReceived?: boolean;
}
