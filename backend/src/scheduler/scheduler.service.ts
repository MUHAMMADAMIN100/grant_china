import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerLockService } from './scheduler-lock.service';
import { JobResult, SCHEDULED_JOBS, ScheduledJob } from './job.contract';
import { toLocal } from './time';

// Kill-switch (тот же приём, что UPLOADS_PROTECTED в app.module.ts). По
// умолчанию включён; SCHEDULER_ENABLED=0 в Railway env выключает без
// передеплоя — используется только как аварийный откат.
const SCHEDULER_ENABLED = process.env.SCHEDULER_ENABLED !== '0';

// Одна джоба не может "съесть" тик планировщика бесконечно — на батч
// (findMany take 500, см. jobs/*.job.ts) может быть больше кандидатов, чем
// вмещается в 500. Ограничиваем число повторных прогонов ОДНОЙ джобы за один
// вызов оркестратора: пропущенные кандидаты подберёт следующий тик (через 15 минут).
const MAX_BATCHES_PER_RUN = 5;

/**
 * Единственный оркестратор планировщика (переиспользуемая основа — волна 4
 * добавит джобу файлом в jobs/, не трогая этот класс). Один @Cron на всё
 * приложение: собственный ритм джобы объявляется через ScheduledJob.everyMinutes,
 * здесь только считается, не пора ли её запускать.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private lock: SchedulerLockService,
    private prisma: PrismaService,
    @Inject(SCHEDULED_JOBS) private jobs: ScheduledJob[],
  ) {
    if (!SCHEDULER_ENABLED) {
      this.logger.error(
        'ВНИМАНИЕ: SCHEDULER_ENABLED=0 — планировщик выключен. Напоминания о ' +
          'повторных звонках (ТЗ 3.2) и авто-архив заявок (ТЗ 3.1) НЕ будут ' +
          'работать, пока флаг не снят. Это аварийный откат — держать его ' +
          'дольше нескольких минут небезопасно.',
      );
    }
  }

  @Cron('*/15 * * * *')
  async tick(): Promise<void> {
    if (!SCHEDULER_ENABLED) return;
    for (const job of this.jobs) {
      await this.runOneSafely(job);
    }
  }

  // Догоняющий прогон при старте контейнера (Railway передеплоивает при
  // каждом пуше) — 30 секунд, чтобы приложение прогрелось и Prisma успела
  // подключиться. Идёт через тот же захват (SchedulerLockService), поэтому
  // несколько перезапусков подряд при неудачном деплое не дадут дублей.
  @Timeout(30_000)
  async catchUp(): Promise<void> {
    if (!SCHEDULER_ENABLED) return;
    for (const job of this.jobs) {
      await this.runOneSafely(job);
    }
  }

  // Волна 4 (риск 1 проекта архитектора): runJob() уже ловит ошибки ВНУТРИ
  // конкретной джобы, но runJobIfDue() читает `job.name`/`job.everyMinutes`
  // ДО этого — если DI когда-нибудь подставит на позицию мульти-провайдера
  // undefined (опечатка в useFactory/inject при добавлении новой джобы), это
  // бросит TypeError прямо из цикла for..of и оборвёт обработку ВСЕХ джоб,
  // идущих ПОСЛЕ сломанной, без единого следа в SchedulerRun. Три строки
  // здесь стоят дешевле, чем «напоминания молча не работают неделю».
  private async runOneSafely(job: ScheduledJob): Promise<void> {
    try {
      await this.runJobIfDue(job);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`[${job?.name ?? '?'}] джоба выпала из цикла планировщика: ${message}`);
    }
  }

  private async runJobIfDue(job: ScheduledJob): Promise<void> {
    const state = await this.prisma.schedulerRun.findUnique({ where: { job: job.name } });
    if (state?.lastRunAt) {
      const dueAt = new Date(state.lastRunAt.getTime() + job.everyMinutes * 60_000);
      if (dueAt.getTime() > Date.now()) return; // ещё рано по собственному ритму джобы
    }
    await this.runJob(job);
  }

  /** Ручной прогон — POST /scheduler/run/:job. Тот же захват: второй вызов подряд просто вернёт false. */
  async runByName(name: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) return false;
    return this.runJob(job);
  }

  private async runJob(job: ScheduledJob): Promise<boolean> {
    const claimed = await this.lock.claim(job.name);
    if (!claimed) {
      this.logger.log(`[${job.name}] пропущен: работает другой инстанс или лок ещё не протух`);
      return false;
    }

    let totalCreated = 0;
    let totalSkipped = 0;
    try {
      let hasMore = true;
      let batches = 0;
      while (hasMore && batches < MAX_BATCHES_PER_RUN) {
        const now = new Date();
        const result: JobResult = await job.run({ now, localNow: toLocal(now), logger: this.logger });
        totalCreated += result.created;
        totalSkipped += result.skipped;
        hasMore = result.hasMore;
        batches += 1;
      }
      // Наблюдаемость (риск проекта: "молчащий планировщик — самый частый и
      // самый незаметный отказ"): пишем результат прогона в лог ВСЕГДА, даже
      // если создано 0 — иначе тишину от "джобы нет кандидатов" не отличить
      // от тишины "джоба не запускается вовсе".
      this.logger.log(`[${job.name}] прогон завершён: создано ${totalCreated}, пропущено ${totalSkipped}`);
      await this.lock.release(job.name, true, { created: totalCreated, skipped: totalSkipped });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`[${job.name}] ошибка прогона: ${message}`);
      await this.lock.release(job.name, false, { created: totalCreated, skipped: totalSkipped, error: message });
      return false;
    }
  }
}
