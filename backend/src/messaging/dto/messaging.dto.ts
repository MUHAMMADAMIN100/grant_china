import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Ответ клиенту из единого окна. */
export class SendMessageDto {
  // Верхняя граница — лимит Telegram на одно сообщение (4096 символов).
  // Резать длину здесь честнее, чем получить отказ от провайдера после того,
  // как менеджер уже нажал «Отправить».
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;
}

/**
 * Ручная привязка диалога к карточке. Пустая строка = отвязать: автопривязка
 * по телефону ставится только при однозначном совпадении, и человек должен
 * иметь возможность как проставить связь, так и снять ошибочную.
 */
export class LinkConversationDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  applicationId?: string;
}

/** Назначить ответственного за диалог. Пустая строка = снять ответственного. */
export class AssignConversationDto {
  @IsOptional()
  @IsString()
  assignedToId?: string;
}
