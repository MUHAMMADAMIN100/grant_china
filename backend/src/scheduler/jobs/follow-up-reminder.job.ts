import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';
import { localHour } from '../time';

// Напоминаем ЗА ЧАС до назначенного звонка — этого достаточно, чтобы
// менеджер успел подготовиться, и не настолько рано, чтобы напоминание
// потерялось среди других уведомлений дня.
const LEAD_MS = 60 * 60 * 1000;

// Приложение лежало сутками/неделями — джоба обязана "догнать" пропущенные
// звонки (они как раз самые просроченные и самые важные), а НЕ игнорировать
// их. Но включение фичи спустя месяцы не должно выстрелить лавиной
// напоминаний из глубокой истории — поэтому верхняя граница "давности".
const MAX_CATCHUP_MS = 14 * 24 * 60 * 60 * 1000; // 14 дней

const BATCH_SIZE = 500;

// "Тихие часы" по Душанбе — не будим менеджера уведомлением в 3 часа ночи.
const QUIET_HOUR_START = 8;
const QUIET_HOUR_END = 21;

/**
 * ТЗ 3.2 — напоминание менеджеру о повторном звонке. САМА задача (Task с
 * dueDate) создаётся СИНХРОННО при сохранении консультации
 * (consultations.service.ts) — эта джоба лишь ДОБАВЛЯЕТ уведомление ближе к
 * моменту звонка, чтобы менеджер не проглядел его в общем списке задач.
 * Если планировщик сломан/выключен — сама задача с датой всё равно есть,
 * ничего не потеряно (см. schedulerPlan проекта архитектора).
 */
@Injectable()
export class FollowUpReminderJob implements ScheduledJob {
  readonly name = 'consultation-follow-up-reminder';
  readonly everyMinutes = 15;

  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async run(ctx: JobContext): Promise<JobResult> {
    // Тихие часы: вне окна просто НЕ занимаем строки (reminderSentAt
    // остаётся null) — следующий прогон внутри окна подберёт их сам.
    // Пропуск здесь безопасен по построению (см. scheduler/time.ts).
    const hour = localHour(ctx.now);
    if (hour < QUIET_HOUR_START || hour >= QUIET_HOUR_END) {
      return { created: 0, skipped: 0, hasMore: false };
    }

    const upperBound = new Date(ctx.now.getTime() + LEAD_MS);
    const lowerBound = new Date(ctx.now.getTime() - MAX_CATCHUP_MS);

    const candidates = await this.prisma.consultation.findMany({
      where: {
        deletedAt: null,
        reminderSentAt: null,
        followUpAt: { not: null, lte: upperBound, gte: lowerBound },
      },
      orderBy: { followUpAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, fullName: true, phone: true, followUpAt: true, managerId: true, createdById: true },
    });

    let created = 0;
    let skipped = 0;
    for (const c of candidates) {
      // Паттерн B (claim-flag, job.contract.ts): атомарно занимаем строку
      // ДО побочного эффекта — только владелец claim'а шлёт уведомление.
      const claimed = await this.prisma.consultation.updateMany({
        where: { id: c.id, reminderSentAt: null },
        data: { reminderSentAt: ctx.now },
      });
      if (claimed.count !== 1) {
        skipped += 1; // кто-то другой (второй инстанс/повторный тик) уже занял
        continue;
      }
      const assigneeId = c.managerId ?? c.createdById;
      if (!assigneeId) {
        skipped += 1;
        continue;
      }
      await this.notifications.notifyUser(assigneeId, {
        type: 'CONSULTATION_FOLLOW_UP',
        title: 'Повторный звонок',
        message: `${c.fullName}, ${c.phone} — пора перезвонить`,
        payload: { consultationId: c.id },
      });
      created += 1;
    }

    return { created, skipped, hasMore: candidates.length === BATCH_SIZE };
  }
}
