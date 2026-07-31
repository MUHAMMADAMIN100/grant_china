import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  // ТЗ 3.2 — перенос/снятие срока. @IsOptional() пропускает валидацию и для
  // undefined (поле не тронуто), и для null (менеджер явно очистил срок) —
  // сервис различает эти два случая через `dto.dueDate !== undefined`.
  @IsOptional()
  @IsISO8601()
  dueDate?: string | null;
}
