import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';

@Module({
  // PrismaService/ActivityService/RealtimeGateway — глобальные модули
  // (@Global() в prisma.module.ts/activity.module.ts/realtime.module.ts),
  // импортировать их здесь не нужно. FilesModule нужен, чтобы PaymentsService
  // мог инвалидировать приватный кэш FileResolverService при удалении чека
  // (см. removeReceipt) — та же причина, что StudentsModule импортирует его.
  imports: [NotificationsModule, FilesModule],
  providers: [PaymentsService],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
