import {
  IsIn,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CallDirection, CallStatus } from '@prisma/client';

const PHONE_RE = /^\+?[\d\s\-()]{5,25}$/;

const DIRECTIONS = Object.values(CallDirection);
const STATUSES = Object.values(CallStatus);

/**
 * ТЗ 6.2 — РУЧНАЯ фиксация звонка сотрудником. Это не заменитель IP-телефонии,
 * а честный базовый режим: пока АТС не подключена (провайдер не выбран),
 * история звонков в карточке всё равно ведётся, и раздел не стоит пустым.
 * Когда появится АТС, те же записи начнут создаваться вебхуком — модель,
 * права и интерфейс не меняются.
 */
export class CreateCallDto {
  @IsString()
  @MinLength(5)
  @MaxLength(25)
  @Matches(PHONE_RE, { message: 'Телефон должен содержать только цифры (с опциональным «+»)' })
  phone: string;

  @IsIn(DIRECTIONS)
  direction: CallDirection;

  @IsOptional()
  @IsIn(STATUSES)
  status?: CallStatus;

  /** Момент начала разговора. Не задан — берётся «сейчас». */
  @IsOptional()
  @IsISO8601()
  startedAt?: string;

  /** Длительность разговора в секундах. 4 часа — заведомо достаточный потолок. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4 * 60 * 60)
  durationSec?: number;

  /** Итог разговора словами менеджера — не транскрипция. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  // Привязки. Обе опциональны: звонок «с улицы» не относится ни к кому, это
  // нормальное состояние данных. Доступ к указанным карточкам проверяет сервис.
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  applicationId?: string;

  @IsOptional()
  @IsString()
  consultationId?: string;
}

/** Правка уже зафиксированного звонка — только итог разговора и привязки. */
export class UpdateCallDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: CallStatus;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  applicationId?: string;
}

/**
 * ТЗ 6.2 — НОРМАЛИЗОВАННЫЙ payload вебхука IP-телефонии.
 *
 * Провайдер АТС ещё не выбран (решение заказчика — «пока каркас»), поэтому
 * контракт описан в собственных терминах CRM, а перевод формата конкретной
 * АТС в этот вид делает адаптер (calls/call-adapters.ts). Когда провайдер
 * появится, добавляется ОДНА функция-адаптер — модель, права, интерфейс и
 * этот DTO не меняются.
 */
export class CallWebhookDto {
  /** Идентификатор звонка у провайдера — ключ идемпотентности. */
  @IsString()
  @MaxLength(120)
  externalId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(25)
  phone: string;

  @IsIn(DIRECTIONS)
  direction: CallDirection;

  @IsOptional()
  @IsIn(STATUSES)
  status?: CallStatus;

  /** Номер/линия агентства, на которую пришёл или с которой ушёл звонок. */
  @IsOptional()
  @IsString()
  @MaxLength(25)
  line?: string;

  @IsOptional()
  @IsISO8601()
  startedAt?: string;

  @IsOptional()
  @IsISO8601()
  answeredAt?: string;

  @IsOptional()
  @IsISO8601()
  endedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  durationSec?: number;

  /** Ссылка на запись разговора У ПРОВАЙДЕРА. Файл в CRM не скачивается. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  recordingUrl?: string;

  /** Внутренний номер или email сотрудника — по нему ищем User. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  agent?: string;

  /** Сырой payload провайдера целиком — уходит в Call.raw (виден только Основателю). */
  @IsOptional()
  @IsObject()
  raw?: Record<string, unknown>;
}
