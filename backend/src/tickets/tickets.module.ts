import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

// PrismaService/ActivityService/RealtimeGateway — глобальные модули
// (@Global() в их собственных модулях), импортировать их здесь не нужно.

/**
 * Раздел «Билеты» (волна 8).
 *
 * Джоба напоминаний (scheduler/jobs/flight-reminder.job.ts) сюда НЕ ходит:
 * она работает с prisma.ticket напрямую, как и все остальные джобы проекта —
 * джоба это инфраструктура планировщика, а не потребитель HTTP-сервиса с
 * ролевыми проверками под конкретного пользователя (тот же приём, что у
 * follow-up-reminder.job.ts и academic-year-reminder.job.ts).
 * Экспорт TicketsService оставлен для будущих потребителей внутри Nest.
 */
@Module({
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
