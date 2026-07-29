import { Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MailModule } from '../mail/mail.module';
import { FilesModule } from '../files/files.module';

@Module({
  // FilesModule — чтобы assignManager() мог сбросить приватный кэш
  // FileResolverService для студента, привязанного к заявке (Проблема 7
  // аудита волны 1). Без цикла: FilesModule ничего не импортирует отсюда.
  imports: [NotificationsModule, TelegramModule, MailModule, FilesModule],
  providers: [ApplicationsService],
  controllers: [ApplicationsController],
})
export class ApplicationsModule {}
