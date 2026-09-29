import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { STUDENT_ARCHIVE_MAX_BATCH } from '../../common/student-archive';

/** 29.09.2026 — «В архив» для одного или нескольких студентов (галочки в списке, кнопка в карточке). */
export class ArchiveStudentsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Выберите хотя бы одного студента' })
  @ArrayMaxSize(STUDENT_ARCHIVE_MAX_BATCH, { message: `За один раз — не больше ${STUDENT_ARCHIVE_MAX_BATCH} студентов` })
  @IsUUID('all', { each: true, message: 'Некорректный идентификатор студента' })
  ids!: string[];

  // Решение владельца: комментарий необязательный.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/** 29.09.2026 — «Вернуть из архива» для одного или нескольких студентов. */
export class UnarchiveStudentsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Выберите хотя бы одного студента' })
  @ArrayMaxSize(STUDENT_ARCHIVE_MAX_BATCH, { message: `За один раз — не больше ${STUDENT_ARCHIVE_MAX_BATCH} студентов` })
  @IsUUID('all', { each: true, message: 'Некорректный идентификатор студента' })
  ids!: string[];
}
