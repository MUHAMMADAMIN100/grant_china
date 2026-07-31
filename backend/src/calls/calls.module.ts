import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

// PrismaService — глобальный модуль. Волна 7 добавит сюда адаптер
// провайдера и вебхук-контроллер, не трогая существующий код чтения.
@Module({
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
