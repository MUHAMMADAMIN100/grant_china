import { Injectable } from '@nestjs/common';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Порог протухания лока — заведомо больше самой долгой ожидаемой джобы.
// Если контейнер упал посреди прогона, running=true "зависнет" в БД;
// следующий тик, пришедший позже этого порога, имеет право перезахватить работу.
const STALE_LOCK_MS = 10 * 60 * 1000; // 10 минут

/**
 * Атомарный захват джобы между несколькими инстансами Railway БЕЗ Redis
 * (см. job.contract.ts). CAS одним UPDATE по строке SchedulerRun: под READ
 * COMMITTED второй инстанс блокируется на той же строке, после коммита
 * первого перечитывает её, не проходит по WHERE и получает count = 0.
 *
 * Рассмотрен и отклонён pg_try_advisory_lock через $queryRaw: advisory-лок
 * сессионный, а Prisma работает через ПУЛ соединений — unlock уехал бы на
 * другое соединение, лок протёк бы до рециклинга пула. Транзакционный
 * pg_advisory_xact_lock потребовал бы держать всю джобу (включая отправку
 * писем) внутри одной долгой транзакции. CAS по обычной строке решает
 * задачу без единого raw SQL, чего в проекте сейчас нет вовсе.
 *
 * Важно: лок ЭКОНОМИТ РАБОТУ, а не обеспечивает корректность — корректность
 * дают паттерны A/B/C идемпотентности внутри самих джоб (job.contract.ts).
 * Даже если два инстанса каким-то образом отработают одновременно, вторая
 * попытка окажется безвредной.
 */
@Injectable()
export class SchedulerLockService {
  // Идентификатор ЭТОГО процесса — виден в SchedulerRun.lockedBy, чтобы в
  // логах Railway было понятно, какой инстанс держит (или держал) работу.
  private readonly instanceId = `${process.env.RAILWAY_REPLICA_ID || hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  constructor(private prisma: PrismaService) {}

  async claim(job: string): Promise<boolean> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_LOCK_MS);
    // Строка джобы должна существовать до CAS — upsert идемпотентен (первый
    // тик после деплоя новой джобы её создаст, дальше только update).
    await this.prisma.schedulerRun.upsert({
      where: { job },
      update: {},
      create: { job },
    });
    const claimed = await this.prisma.schedulerRun.updateMany({
      where: { job, OR: [{ running: false }, { lockedAt: { lt: staleCutoff } }] },
      data: { running: true, lockedAt: now, lockedBy: this.instanceId },
    });
    return claimed.count === 1;
  }

  async release(job: string, ok: boolean, result: { created: number; skipped: number; error?: string }): Promise<void> {
    const now = new Date();
    await this.prisma.schedulerRun.update({
      where: { job },
      data: {
        running: false,
        lastRunAt: now,
        ...(ok ? { lastOkAt: now, lastError: null } : { lastError: result.error ?? 'Неизвестная ошибка' }),
        lastCreated: result.created,
        lastSkipped: result.skipped,
        runs: { increment: 1 },
      },
    });
  }

  async status() {
    return this.prisma.schedulerRun.findMany({ orderBy: { job: 'asc' } });
  }
}
