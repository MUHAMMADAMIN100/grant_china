import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  // PrismaService/ActivityService/RealtimeGateway — глобальные модули
  // (@Global() в их собственных модулях), импортировать их здесь не нужно.
  // TasksModule — ЕДИНСТВЕННАЯ зависимость раздела 3.2: ConsultationsService
  // создаёт/переносит/гасит автозадачи только через TasksService, без
  // прямого доступа к prisma.task (граница модуля, см. apiSurface проекта).
  imports: [TasksModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService],
})
export class ConsultationsModule {}
