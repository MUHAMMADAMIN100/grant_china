import { Global, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { StaffBotService } from './staff-bot.service';

/**
 * @Global (12.08.2026): StaffBotService нужен NotificationsService, а тот
 * подключён почти всюду. Глобальный модуль избавляет от импорта TelegramModule
 * в десяток мест ради одного провайдера — тот же приём, что у PrismaModule.
 */
@Global()
@Module({
  providers: [TelegramService, StaffBotService],
  exports: [TelegramService, StaffBotService],
})
export class TelegramModule {}
