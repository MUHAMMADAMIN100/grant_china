import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ActivityService } from '../../activity/activity.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AUTO_ARCHIVE_MODE, ENROLLED_ARCHIVE_DAYS, STALE_NEW_ARCHIVE_DAYS } from '../../common/archive-rules';
import { localDayStart } from '../time';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';

const BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ТЗ 3.1 — авто-архив по неактивности. Ровно два правила, оба по молчанию
 * заявки, НИ ОДНО не по "просто статусу" (archiveRule проекта архитектора):
 *  1) ENROLLED + ENROLLED_ARCHIVE_DAYS без изменений — зачислен, но работа
 *     с оплатами продолжается ещё месяцами, поэтому не сразу.
 *  2) NEW + STALE_NEW_ARCHIVE_DAYS без изменений — протухший лид.
 * Остальные статусы воронки НИКОГДА не архивируются автоматически — тишина
 * на них это управленческая проблема (раздел 5, KPI), а не повод спрятать заявку.
 *
 * AUTO_ARCHIVE_MODE=dry (дефолт) — kill-switch первого боевого прогона:
 * джоба ничего не пишет, только считает кандидатов и раз в сутки шлёт
 * FOUNDER одно уведомление. Среди 229 исторических заявок много старых —
 * безусловный первый прогон "NEW 90 дней" увёл бы в архив заметную долю
 * базы одним махом, что выглядело бы как "CRM потеряла заявки".
 */
@Injectable()
export class ApplicationAutoArchiveJob implements ScheduledJob {
  readonly name = 'application-auto-archive';
  readonly everyMinutes = 60;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
  ) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const enrolledCutoff = new Date(ctx.now.getTime() - ENROLLED_ARCHIVE_DAYS * DAY_MS);
    const staleCutoff = new Date(ctx.now.getTime() - STALE_NEW_ARCHIVE_DAYS * DAY_MS);

    if (AUTO_ARCHIVE_MODE === 'dry') {
      const [enrolledCount, staleCount] = await Promise.all([
        this.prisma.application.count({
          where: { deletedAt: null, archivedAt: null, status: 'ENROLLED', updatedAt: { lt: enrolledCutoff } },
        }),
        this.prisma.application.count({
          where: { deletedAt: null, archivedAt: null, status: 'NEW', updatedAt: { lt: staleCutoff } },
        }),
      ]);
      const total = enrolledCount + staleCount;
      if (total > 0) {
        await this.notifyDryRunOnce(ctx.now, total);
      }
      return { created: 0, skipped: total, hasMore: false };
    }

    // AUTO_ARCHIVE_MODE=on — реально архивируем, батчами (жёсткий кап за
    // прогон — иначе первый прогон после суточного простоя сделает один
    // гигантский UPDATE).
    //
    // ОБА правила выполняются в КАЖДОМ тике. Раньше здесь стоял ранний return
    // после ENROLLED, и правило «протухший лид» не срабатывало вообще: hasMore
    // выставляется только когда батч заполнен целиком (BATCH_SIZE), а на живых
    // объёмах кандидатов единицы. То есть достаточно было одной зачисленной
    // заявки в день, чтобы второе правило не отработало НИКОГДА.
    const enrolled = await this.archiveBatch(
      { deletedAt: null, archivedAt: null, status: 'ENROLLED', updatedAt: { lt: enrolledCutoff } },
      'AUTO: зачислен, 30 дней без изменений',
      ctx.now,
    );

    const stale = await this.archiveBatch(
      { deletedAt: null, archivedAt: null, status: 'NEW', updatedAt: { lt: staleCutoff } },
      'AUTO: не в работе 90 дней',
      ctx.now,
    );

    // hasMore, если ХОТЬ ОДИН батч заполнился до конца — значит кандидаты
    // остались и оркестратор должен вызвать джобу повторно.
    return {
      created: enrolled.count + stale.count,
      skipped: 0,
      hasMore: enrolled.count === BATCH_SIZE || stale.count === BATCH_SIZE,
    };
  }

  private async archiveBatch(
    where: Prisma.ApplicationWhereInput,
    reason: string,
    now: Date,
  ): Promise<{ count: number }> {
    const rows = await this.prisma.application.findMany({
      where,
      select: { id: true, fullName: true, studentId: true, managerId: true, chinaManagerId: true },
      take: BATCH_SIZE,
    });
    if (!rows.length) return { count: 0 };

    const ids = rows.map((r) => r.id);
    // Паттерн C (желаемое состояние, job.contract.ts): перепроверяем
    // archivedAt: null прямо в WHERE самого UPDATE — идемпотентно по
    // построению, повторный прогон (или второй инстанс) найдёт 0 строк.
    await this.prisma.application.updateMany({
      where: { id: { in: ids }, archivedAt: null, deletedAt: null },
      data: { archivedAt: now, archiveReason: reason },
    });

    for (const row of rows) {
      this.activity
        .log({
          actorId: null,
          actorName: 'Планировщик',
          actorRole: 'SYSTEM',
          action: 'APPLICATION_ARCHIVE',
          studentId: row.studentId,
          studentName: row.fullName,
          details: `Заявка отправлена в архив автоматически: ${reason}`,
        })
        .catch(() => undefined);
      this.realtime.emitForStudent(row, 'application:updated', { id: row.id, studentId: row.studentId });
    }

    return { count: rows.length };
  }

  /** Не спамим одним и тем же уведомлением каждые 15–60 минут, пока джоба в dry-режиме. */
  private async notifyDryRunOnce(now: Date, total: number): Promise<void> {
    const dayStart = localDayStart(now);
    const already = await this.prisma.notification.findFirst({
      where: { type: 'AUTO_ARCHIVE_DRY_RUN', createdAt: { gte: dayStart } },
    });
    if (already) return;
    await this.notifications.notifyFounders({
      type: 'AUTO_ARCHIVE_DRY_RUN',
      title: 'Готово к авто-архиву',
      message: `Готово к авто-архиву: ${total} заявок. Планировщик работает в режиме "dry" (AUTO_ARCHIVE_MODE) — ничего не архивирует, пока вы не включите AUTO_ARCHIVE_MODE=on в переменных окружения.`,
      payload: { total },
    });
  }
}
