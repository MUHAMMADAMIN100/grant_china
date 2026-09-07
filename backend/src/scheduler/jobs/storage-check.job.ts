import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { StorageService } from '../../files/storage.service';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';
import { localDayStart } from '../time';

/** Ниже этого — предупреждаем: и по доле, и по абсолюту (маленький том может быть «на 9%» = 400 МБ). */
const WARN_FREE_PERCENT = 10;
const WARN_FREE_BYTES = 500 * 1024 * 1024;

/**
 * 07.09.2026 — раз в час проверяет диск загрузок и предупреждает руководство
 * ЗАРАНЕЕ, а не когда уже три дня ничего не сохраняется.
 *
 * Два уровня: «мало места» (ниже порога) и «файлы не записываются» (проба
 * записи провалилась). Одно уведомление в сутки на уровень — тот же приём
 * дедупликации, что у FLIGHT_NO_MANAGER: спамить каждый час бессмысленно,
 * молчать — опасно.
 */
@Injectable()
export class StorageCheckJob implements ScheduledJob {
  readonly name = 'storage-check';
  readonly everyMinutes = 60;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private notifications: NotificationsService,
  ) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const h = await this.storage.health();
    const mb = (b: number | null) => (b === null ? '?' : Math.round(b / 1048576).toLocaleString('ru-RU'));
    let created = 0;

    if (!h.writable) {
      created += await this.notifyOnce(ctx.now, 'STORAGE_BROKEN', 'Файлы не сохраняются на сервере', `Проба записи в каталог загрузок провалилась (${h.writeError ?? 'неизвестная ошибка'}). Чеки, билеты и документы сейчас не загружаются. Свободно: ${mb(h.freeBytes)} МБ из ${mb(h.totalBytes)} МБ. Проверьте диск сервера.`);
    } else if (h.freeBytes !== null && (h.freeBytes < WARN_FREE_BYTES || (h.freePercent !== null && h.freePercent < WARN_FREE_PERCENT))) {
      created += await this.notifyOnce(ctx.now, 'STORAGE_LOW', 'На диске сервера мало места', `Свободно ${mb(h.freeBytes)} МБ из ${mb(h.totalBytes)} МБ (${h.freePercent}%). Когда место кончится, файлы перестанут сохраняться. Увеличьте диск или уберите файлы-сироты на дашборде.`);
    }

    ctx.logger.log(`Диск загрузок: ${h.writable ? 'пишется' : 'НЕ ПИШЕТСЯ (' + h.writeError + ')'}, свободно ${mb(h.freeBytes)} МБ, файлов ${h.filesCount}`);
    return { created, skipped: 0, hasMore: false };
  }

  private async notifyOnce(now: Date, type: string, title: string, message: string): Promise<number> {
    const already = await this.prisma.notification.findFirst({ where: { type, createdAt: { gte: localDayStart(now) } } });
    if (already) return 0;
    await this.notifications.notifyAdminsAndFounders({ type, title, message });
    return 1;
  }
}
