import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  // Длина режется здесь; превью для ActivityLog.details обрезается сервисом
  // отдельно до ~200 символов (см. comments.service.ts).
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  applicationId?: string;
}
