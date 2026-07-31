import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MinLength, MaxLength } from 'class-validator';
import { Direction } from '@prisma/client';
import { LEAD_SOURCE_VALUES } from '../../common/lead-source';

// E.164: '+' необязателен, 7–15 цифр всего, разрешаем пробелы/дефисы при вводе.
const PHONE_RE = /^\+?[\d\s\-()]{7,20}$/;

export class CreateApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MinLength(5)
  @MaxLength(40)
  @Matches(PHONE_RE, { message: 'phone должен содержать только цифры (с опциональным «+» и пробелами/дефисами)' })
  phone: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsEnum(Direction)
  direction: Direction;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  // Раздел 3.1 ТЗ — источник привлечения. Эндпоинт /applications/public
  // анонимный (лендинг), поэтому строго @IsIn(LEAD_SOURCE_VALUES) — приняли
  // бы что угодно от недоверенного клиента без этой проверки. Опционально:
  // старый закэшированный бандл лендинга не шлёт это поле вовсе, сервис
  // подставляет значение по умолчанию (см. applications.service.create()).
  @IsOptional()
  @IsIn(LEAD_SOURCE_VALUES)
  source?: string;

  // Свободный текст-уточнение (utm, @ник, кампания). Режем длину — поле
  // приходит от анонима на публичном эндпоинте.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;
}
