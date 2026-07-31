import { Module } from '@nestjs/common';
import { KpiService } from './kpi.service';
import { CompensationService } from './compensation.service';
import { CompensationController } from './compensation.controller';
import { RulesService } from './rules.service';
import { RulesController } from './rules.controller';
import { PayslipsService } from './payslips.service';
import { PayrollMeController } from './payroll-me.controller';
import { PayrollAdminController } from './payroll-admin.controller';
import { NotificationsModule } from '../notifications/notifications.module';

// PrismaService/ActivityService/RealtimeGateway — глобальные модули
// (@Global() в собственных модулях), импортировать их здесь не нужно.
// NotificationsModule нужен явно — тот же приём, что в PaymentsModule.
@Module({
  imports: [NotificationsModule],
  controllers: [PayrollMeController, PayrollAdminController, RulesController, CompensationController],
  providers: [KpiService, CompensationService, RulesService, PayslipsService],
  // KpiService нужен планировщику (payroll-period-close.job.ts) напрямую —
  // экспортируем сервисы модуля для переиспользования джобой SchedulerModule.
  exports: [KpiService, CompensationService, RulesService, PayslipsService],
})
export class PayrollModule {}
