import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { TelegramClientBotService } from './telegram-client.service';
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
  controllers: [MessagingController],
  providers: [MessagingService, TelegramClientBotService],
  exports: [MessagingService],
})
export class MessagingModule {}
