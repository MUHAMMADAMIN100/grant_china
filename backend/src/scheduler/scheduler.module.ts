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
import { FlightReminderJob } from './jobs/flight-reminder.job';
import { StorageCheckJob } from './jobs/storage-check.job';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TasksModule } from '../tasks/tasks.module';
import { PayrollModule } from '../payroll/payroll.module';

@Module({
  imports: [
    // 07.09.2026 — StorageCheckJob берёт пробу записи из FilesModule.StorageService.
    FilesModule,
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
    FlightReminderJob,
    StorageCheckJob,
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
        e: FlightReminderJob,
        f: StorageCheckJob,
      ) => [a, b, c, d, e, f],
      inject: [
        FollowUpReminderJob,
        ApplicationAutoArchiveJob,
        AcademicYearReminderJob,
        PayrollPeriodCloseJob,
        FlightReminderJob,
        StorageCheckJob,
      ],
    },
  ],
})
export class SchedulerModule {}
