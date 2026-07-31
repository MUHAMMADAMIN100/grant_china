import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TicketStatus } from '@prisma/client';

/**
 * Раздел «Билеты», п.3 ТЗ. Обязательные поля ровно те, что перечислены в ТЗ:
 * студент, город назначения, дата и время вылета, номер рейса. Остальное —
 * опционально (в том числе дата прилёта: ТЗ помечает её как необязательную,
 * «опционально для контроля стыковок»).
 *
 * Даты приходят ISO-строкой: фронт вводит их через <input type="datetime-local">
 * и шлёт new Date(v).toISOString(). JS трактует datetime-local как ЛОКАЛЬНОЕ
 * время браузера, а браузер менеджера стоит по Душанбе — «10:00» само
 * превращается в 05:00Z, TZ-математики на сервере для этого пути не нужно
 * (тот же приём, что у Task.dueDate и Consultation.followUpAt).
 */
export class CreateTicketDto {
  @IsString()
  studentId: string;

  // Город — свободная строка (справочник + свой вариант, решение заказчика).
  // Валидируем только длину: @IsIn(CHINA_CITY_VALUES) сломал бы редкий маршрут.
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  destinationCity: string;

  @IsISO8601()
  departureAt: string;

  @IsOptional()
  @IsISO8601()
  arrivalAt?: string;

  // «SU-208», «CZ 6008», «HU7996» — форму записи не навязываем, только длину.
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  flightNumber: string;

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
