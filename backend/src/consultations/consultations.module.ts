import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { TasksModule } from '../tasks/tasks.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // PrismaService/ActivityService/RealtimeGateway — глобальные модули
  // (@Global() в их собственных модулях), импортировать их здесь не нужно.
  // TasksModule — ЕДИНСТВЕННАЯ зависимость раздела 3.2: ConsultationsService
  // создаёт/переносит/гасит автозадачи только через TasksService, без
  // прямого доступа к prisma.task (граница модуля, см. apiSurface проекта).
  // NotificationsModule — уведомление о новой консультации (12.08.2026):
  // падает в колокольчик менеджеру и оттуда автоматически в его Telegram.
  imports: [TasksModule, NotificationsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
})
export class ConsultationsModule {}
