import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { SchedulerLockService } from './scheduler-lock.service';
import { SchedulerController } from './scheduler.controller';
import { SCHEDULED_JOBS } from './job.contract';
import { FollowUpReminderJob } from './jobs/follow-up-reminder.job';
import { ApplicationAutoArchiveJob } from './jobs/application-auto-archive.job';
import { AcademicYearReminderJob } from './jobs/academic-year-reminder.job';
import { PayrollPeriodCloseJob } from './jobs/payroll-period-close.job';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { PayrollModule } from '../payroll/payroll.module';

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
    // Раздел 5 ТЗ (волна 6) — PayrollPeriodCloseJob генерирует листы через
    // PayslipsService (экспортирован из PayrollModule), минуя HTTP-слой.
    PayrollModule,
  ],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    SchedulerLockService,
    FollowUpReminderJob,
    ApplicationAutoArchiveJob,
    AcademicYearReminderJob,
    PayrollPeriodCloseJob,
    // Мульти-провайдер: оркестратор (scheduler.service.ts) получает список
    // джоб через DI и не знает о них поимённо. Новые джобы дописываются в
    // КОНЕЦ массива намеренно (риск 1 проекта архитектора): если в одной из
    // них когда-нибудь появится баг, более ранние джобы (звонки, авто-архив,
    // учебный год) всё равно успеют отработать в этом тике.
    {
      provide: SCHEDULED_JOBS,
      useFactory: (
        a: FollowUpReminderJob,
        b: ApplicationAutoArchiveJob,
        c: AcademicYearReminderJob,
        d: PayrollPeriodCloseJob,
      ) => [a, b, c, d],
      inject: [FollowUpReminderJob, ApplicationAutoArchiveJob, AcademicYearReminderJob, PayrollPeriodCloseJob],
    },
  ],
})
export class SchedulerModule {}
