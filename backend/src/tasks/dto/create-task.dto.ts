import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;

  @IsString()
  assignedToId: string;

  // ТЗ 3.2 — дата и время повторного звонка/срок задачи. Опционально: у
  // существующих задач срока нет и большинство ручных задач его тоже не
  // указывает. Фронт шлёт ISO-строку из <input type="datetime-local">.
  @IsOptional()
  @IsISO8601()
  dueDate?: string;
}
