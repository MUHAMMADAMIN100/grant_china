import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { TelegramClientBotService } from './telegram-client.service';
import { InstagramApi, MetaTokensService, WhatsAppApi } from './meta/meta.api';
import { MetaMediaService } from './meta/meta.media';
import { logMetaConfig, MetaChatsService } from './meta/meta-chats.service';
import { MetaChatsController, MetaWebhooksController, PublicChatFilesController } from './meta/meta.controllers';
import { NotificationsModule } from '../notifications/notifications.module';

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
  controllers: [MessagingController, MetaWebhooksController, MetaChatsController, PublicChatFilesController],
  providers: [MessagingService, TelegramClientBotService, MetaTokensService, InstagramApi, WhatsAppApi, MetaMediaService, MetaChatsService],
  // MetaTokensService — наружу ради джобы instagram-token (продление ключа).
  exports: [MessagingService, MetaTokensService],
})
export class MessagingModule implements OnModuleInit {
  onModuleInit() {
    // Неполная настройка видна в журнале сразу при запуске, а не первым потерянным сообщением.
    logMetaConfig(new Logger('Meta'));
  }
}
