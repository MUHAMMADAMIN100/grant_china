import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { TelegramClientBotService } from './telegram-client.service';
import { InstagramApi, MetaTokensService, WhatsAppApi } from './meta/meta.api';
import { MetaMediaService } from './meta/meta.media';
import { logMetaConfig, MetaChatsService } from './meta/meta-chats.service';
import { MetaChatsController, MetaWebhooksController, PublicChatFilesController } from './meta/meta.controllers';
import { NotificationsModule } from '../notifications/notifications.module';
import { instagramConfig, instagramLogin } from './meta/meta.config';
import { ChatAiService } from './ai/chat-ai.service';
import { ChatAiController, QuickRepliesController, QuickRepliesService } from './ai/chat-ai.controller';

/**
 * ТЗ 6.4 — единое окно диалогов из мессенджеров.
 *
 * PrismaService/ActivityService/RealtimeGateway — глобальные модули.
 * NotificationsModule импортируется явно: входящее сообщение должно поднять
 * колокольчик ответственному, иначе оно пролежит в CRM до тех пор, пока
 * кто-нибудь не откроет раздел.
 *
 * TelegramClientBotService — ОТДЕЛЬНЫЙ сервис и отдельный бот, не тот, что в
 * TelegramModule: у служебного бота (уведомления сотрудникам, посты программ
 * в канал) другой токен, другая аудитория и другая ответственность.
 */
@Module({
  imports: [NotificationsModule],
  // 29.10.2026 — Instagram и WhatsApp через приложения Meta (папка meta/).
  // 21.11.2026 — ИИ-помощник в Instagram и быстрые ответы (папка ai/).
  controllers: [MessagingController, MetaWebhooksController, MetaChatsController, PublicChatFilesController, ChatAiController, QuickRepliesController],
  providers: [
    MessagingService,
    TelegramClientBotService,
    MetaTokensService,
    InstagramApi,
    WhatsAppApi,
    MetaMediaService,
    MetaChatsService,
    ChatAiService,
    QuickRepliesService,
  ],
  // MetaTokensService и InstagramApi — наружу ради джобы instagram-token
  // (продление ключа / подписка аккаунта на уведомления).
  exports: [MessagingService, MetaTokensService, InstagramApi],
})
export class MessagingModule implements OnModuleInit {
  constructor(private chats: MetaChatsService) {}

  onModuleInit() {
    const logger = new Logger('Meta');
    // Неполная настройка видна в журнале сразу при запуске, а не первым потерянным сообщением.
    logMetaConfig(logger);
    // 09.11.2026, единый вход: ключ в Railway меняют — сервер перезапускается —
    // и сразу подписывает аккаунт на уведомления, не дожидаясь джобы (до 6 часов).
    // В фоне: старт сервера от ответа Meta не зависит.
    // 25.11.2026 — каждый аккаунт Instagram подписывается на уведомления и
    // сообщает своё @имя (нужно в уведомлениях и в источнике заявки).
    if (instagramConfig().enabled) void this.chats.warmUp();
  }
}
