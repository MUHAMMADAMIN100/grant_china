import { Module } from '@nestjs/common';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';
import { TasksModule } from '../tasks/tasks.module';

// PrismaService/ActivityService/RealtimeGateway — глобальные модули
// (@Global() в их собственных модулях), импортировать их здесь не нужно.
// TasksModule — единственная зависимость: СОЗДАЁТ задачу «Позвонить и
// проинформировать» по-прежнему только планировщик, но при переносе даты
// нового учебного года сервис обязан пересинхронизировать/погасить уже
// созданную задачу (иначе она навсегда остаётся со старой датой — джоба
// упирается в занятый originKey). Прямой доступ к prisma.task запрещён,
// поэтому только через TasksService (как в ConsultationsModule).
@Module({
  imports: [TasksModule],
  controllers: [GrantsController],
  providers: [GrantsService],
})
export class GrantsModule {}
