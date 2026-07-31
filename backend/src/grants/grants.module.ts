import { Module } from '@nestjs/common';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';

// PrismaService/ActivityService/RealtimeGateway — глобальные модули
// (@Global() в их собственных модулях), импортировать их здесь не нужно.
// GrantsModule ни от кого не зависит: он НЕ зовёт TasksService — задачу
// «Позвонить и проинформировать» создаёт только планировщик (см. apiSurface
// проекта архитектора — «одна причина для изменения»).
@Module({
  controllers: [GrantsController],
  providers: [GrantsService],
})
export class GrantsModule {}
