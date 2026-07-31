import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { SchedulerLockService } from './scheduler-lock.service';
import { SchedulerController } from './scheduler.controller';
import { SCHEDULED_JOBS } from './job.contract';
import { FollowUpReminderJob } from './jobs/follow-up-reminder.job';
import { ApplicationAutoArchiveJob } from './jobs/application-auto-archive.job';
import { AcademicYearReminderJob } from './jobs/academic-year-reminder.job';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    // РОВНО ОДИН РАЗ на всё приложение (см. schedulerPlan проекта
    // архитектора) — два forRoot() дали бы два независимых набора таймеров,
    // то есть двойные прогоны внутри одного процесса.
    ScheduleModule.forRoot(),
    NotificationsModule,
    // ТЗ 4 (волна 4) — AcademicYearReminderJob создаёт системные задачи
    // ИСКЛЮЧИТЕЛЬНО через TasksService.createSystemTask(), прямой доступ к
    // prisma.task из джобы запрещён архитектурой (единая точка идемпотентности).
    TasksModule,
  ],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    SchedulerLockService,
    FollowUpReminderJob,
    ApplicationAutoArchiveJob,
    AcademicYearReminderJob,
    // Мульти-провайдер: оркестратор (scheduler.service.ts) получает список
    // джоб через DI и не знает о них поимённо. AcademicYearReminderJob стоит
    // ПОСЛЕДНЕЙ в массиве намеренно (риск 1 проекта архитектора): если в ней
    // когда-нибудь появится баг, напоминания о звонках и авто-архив заявок
    // (обе идут раньше) всё равно успеют отработать в этом тике.
    {
      provide: SCHEDULED_JOBS,
      useFactory: (a: FollowUpReminderJob, b: ApplicationAutoArchiveJob, c: AcademicYearReminderJob) => [a, b, c],
      inject: [FollowUpReminderJob, ApplicationAutoArchiveJob, AcademicYearReminderJob],
    },
  ],
})
export class SchedulerModule {}
