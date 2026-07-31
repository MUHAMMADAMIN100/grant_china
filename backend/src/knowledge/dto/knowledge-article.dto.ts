import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { KNOWLEDGE_CATEGORY_VALUES } from '../knowledge-categories';

/**
 * ТЗ 6.1 — статья базы знаний. Длина тела ограничена 20 000 символов не из
 * соображений хранения, а из-за окна контекста: ВСЕ опубликованные статьи
 * склеиваются в системный промпт запроса к модели (ai.service.ts). Одна
 * статья-простыня на 200 КБ вытеснила бы из контекста все остальные, и
 * помощник начал бы отвечать «не знаю» на вопросы, ответ на которые есть.
 */
export class CreateKnowledgeArticleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_CATEGORY_VALUES)
  category?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(20000)
  body: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @ArrayMaxSize(20)
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdateKnowledgeArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_CATEGORY_VALUES)
  category?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20000)
  body?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @ArrayMaxSize(20)
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}
