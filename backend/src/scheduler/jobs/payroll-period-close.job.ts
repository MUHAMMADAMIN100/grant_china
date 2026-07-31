import { Injectable } from '@nestjs/common';
import { PayslipsService } from '../../payroll/payslips.service';
import { previousPeriodKey } from '../../payroll/period';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';
import { localHour, toLocal } from '../time';

// «Тихие часы» по Душанбе — тот же приём, что в academic-year-reminder.job.ts:
// генерация листов не должна будить сотрудников уведомлением о зарплате ночью.
const ALLOWED_HOUR_START = 9;
const ALLOWED_HOUR_END = 20;

/**
 * Раздел 5 ТЗ (волна 6) — «закрытие периода»: первого числа локального
 * месяца (по Душанбе), вне тихих часов, создаёт DRAFT-листы за ПРОШЛЫЙ
 * период для всех живых EMPLOYEE/ADMIN и уведомляет Основателя
 * (notifyFounders — см. payslips.service.ts generate()).
 *
 * ИДЕМПОТЕНТНОСТЬ — паттерн A (job.contract.ts): PayslipsService.generate()
 * создаёт строки с @@unique([userId, periodKey, revision]) и ловит P2002 как
 * skipped. Джоба тикает каждый час первого числа — повторные прогоны в
 * течение дня (или после рестарта контейнера) безопасны, потому что второй
 * и последующие прогоны просто ничего не создают заново.
 *
 * Работает НАПРЯМУЮ через PayslipsService (не HTTP-контроллер) — тот же
 * приём, что у follow-up-reminder.job.ts и academic-year-reminder.job.ts:
 * джоба — инфраструктура планировщика, actor = null (системный вызов, см.
 * payslips.service.ts generate()).
 */
@Injectable()
export class PayrollPeriodCloseJob implements ScheduledJob {
  readonly name = 'payroll-period-close';
  readonly everyMinutes = 60;

  constructor(private payslips: PayslipsService) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const hour = localHour(ctx.now);
    if (hour < ALLOWED_HOUR_START || hour >= ALLOWED_HOUR_END) {
      return { created: 0, skipped: 0, hasMore: false };
    }
    // Только первое число локального месяца — джоба-«будильник», а не
    // ежедневная генерация: за один и тот же periodKey листы создаются
    // ровно один раз (остальные прогоны — идемпотентный no-op).
    if (toLocal(ctx.now).getUTCDate() !== 1) {
      return { created: 0, skipped: 0, hasMore: false };
    }

    const periodKey = previousPeriodKey(ctx.now);
    const result = await this.payslips.generate(periodKey, null);
    ctx.logger.log(`[${this.name}] период ${periodKey}: создано ${result.created}, пропущено ${result.skipped}`);
    return { created: result.created, skipped: result.skipped, hasMore: false };
  }
}
