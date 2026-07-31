import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TicketStatus } from '@prisma/client';

/**
 * Все поля опциональны — PATCH меняет только присланное. studentId сюда
 * СОЗНАТЕЛЬНО не входит: перевесить билет на другого студента означало бы
 * поменять и владельца прикреплённых Document (они привязаны к studentId
 * ради защиты /uploads), то есть тихо отдать чужой скан не тому менеджеру.
 * Если билет завели не тому студенту — удаляют и заводят заново.
 */
export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  destinationCity?: string;

  @IsOptional()
  @IsISO8601()
  departureAt?: string;

  // null здесь невыразим через @IsISO8601, поэтому «стереть дату прилёта»
  // делается пустой строкой — сервис приводит её к null (см. tickets.service).
  @IsOptional()
  @IsString()
  arrivalAt?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  flightNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  airline?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
