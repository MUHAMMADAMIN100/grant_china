import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { SchedulerLockService } from './scheduler-lock.service';
import { SchedulerController } from './scheduler.controller';
import { SCHEDULED_JOBS } from './job.contract';
import { FollowUpReminderJob } from './jobs/follow-up-reminder.job';
import { ApplicationAutoArchiveJob } from './jobs/application-auto-archive.job';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    // РОВНО ОДИН РАЗ на всё приложение (см. schedulerPlan проекта
    // архитектора) — два forRoot() дали бы два независимых набора таймеров,
    // то есть двойные прогоны внутри одного процесса.
    ScheduleModule.forRoot(),
    NotificationsModule,
  ],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    SchedulerLockService,
    FollowUpReminderJob,
    ApplicationAutoArchiveJob,
    // Мульти-провайдер: оркестратор (scheduler.service.ts) получает список
    // джоб через DI и не знает о них поимённо — волна 4 добавит джобу сюда
    // одной строкой, не трогая ни одну существующую.
    {
      provide: SCHEDULED_JOBS,
      useFactory: (a: FollowUpReminderJob, b: ApplicationAutoArchiveJob) => [a, b],
      inject: [FollowUpReminderJob, ApplicationAutoArchiveJob],
    },
  ],
})
export class SchedulerModule {}
