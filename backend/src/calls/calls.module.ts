import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

// PrismaService/ActivityService/RealtimeGateway — глобальные модули.
//
// Волна 8 (ТЗ 6.2) достроила заготовку волны 4 до рабочего модуля: ручная
// фиксация звонка, определение клиента по номеру (всплывающая карточка) и
// вебхук АТС с адаптерами (call-adapters.ts). Подключение конкретного
// провайдера телефонии — это одна функция-адаптер, модель Call и права при
// этом не меняются.
@Module({
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
