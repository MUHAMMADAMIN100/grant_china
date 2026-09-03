import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Билет, который СТУДЕНТ подаёт из личного кабинета (26.08.2026).
 *
 * Отличия от CreateTicketDto сотрудника — не косметика:
 *  - нет studentId: студент подаёт только за себя, id берётся из его сессии.
 *    Поле в теле означало бы, что подделанным запросом можно завести билет
 *    чужому студенту.
 *  - статус ограничен двумя значениями. «Изменён» и «Отменён» — это стадии
 *    жизни уже существующего билета, которыми управляет менеджер; студент
 *    сообщает только, забронировал он или уже выкупил.
 * Остальные поля и их пределы — те же, что у сотрудника, чтобы после
 * подтверждения запись ничем не отличалась от заведённой в CRM.
 *
 * Даты — ISO-строки: кабинет вводит их через <input type="datetime-local">
 * и шлёт new Date(v).toISOString(), как и CRM (см. CreateTicketDto).
 */
export const STUDENT_TICKET_STATUSES = ['BOOKED', 'PURCHASED'] as const;
export type StudentTicketStatus = (typeof STUDENT_TICKET_STATUSES)[number];

export class StudentTicketDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  destinationCity: string;

  @IsISO8601()
  departureAt: string;

  @IsOptional()
  @IsISO8601()
  arrivalAt?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(20)
  flightNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  airline?: string;

  @IsOptional()
  @IsIn(STUDENT_TICKET_STATUSES)
  status?: StudentTicketStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/** Правка студентом СВОЕГО билета, пока он на проверке. Все поля опциональны — PATCH. */
export class StudentTicketUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  destinationCity?: string;

  @IsOptional()
  @IsISO8601()
  departureAt?: string;

  // Пустая строка = «стереть дату прилёта», как в UpdateTicketDto.
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
  @IsIn(STUDENT_TICKET_STATUSES)
  status?: StudentTicketStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
