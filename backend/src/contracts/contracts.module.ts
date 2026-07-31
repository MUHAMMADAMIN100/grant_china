import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

// PrismaService/ActivityService/RealtimeGateway — глобальные модули
// (@Global() в собственных модулях), импортировать здесь не нужно.
@Module({
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
