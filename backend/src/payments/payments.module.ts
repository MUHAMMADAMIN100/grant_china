import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { FinanceAnalyticsController } from './finance-analytics.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';

@Module({
  // PrismaService/ActivityService/RealtimeGateway — глобальные модули
  // (@Global() в prisma.module.ts/activity.module.ts/realtime.module.ts),
  // импортировать их здесь не нужно. FilesModule нужен, чтобы PaymentsService
  // мог инвалидировать приватный кэш FileResolverService при удалении чека
  // (см. removeReceipt) — та же причина, что StudentsModule импортирует его.
  imports: [NotificationsModule, FilesModule],
  // FinanceAnalyticsService (раздел 2.6 ТЗ) переиспользует PaymentsService.pendingCount()
  // вместо дублирования запроса очереди на одобрение — оба провайдера должны
  // жить в одном модуле, чтобы Nest мог внедрить PaymentsService в конструктор.
  providers: [PaymentsService, FinanceAnalyticsService],
  controllers: [PaymentsController, FinanceAnalyticsController],
})
export class PaymentsModule {}
