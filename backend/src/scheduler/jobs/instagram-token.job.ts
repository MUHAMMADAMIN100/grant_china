import { Injectable } from '@nestjs/common';
import { MetaTokensService } from '../../messaging/meta/meta.api';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';

/**
 * 29.10.2026 — ключ Instagram живёт 60 дней и продлевается обменом на свежий.
 * Проверяем каждые 6 часов, меняем не чаще раза в 20 часов и только когда до
 * конца срока меньше 30 дней (или срок ещё неизвестен). Без настроенного
 * Instagram джоба ничего не делает.
 */
@Injectable()
export class InstagramTokenJob implements ScheduledJob {
  readonly name = 'instagram-token';
  readonly everyMinutes = 360;

  constructor(private tokens: MetaTokensService) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const r = await this.tokens.refreshInstagramToken(ctx.now);
    if (r !== 'disabled' && r !== 'skipped') ctx.logger.log(`Ключ Instagram: ${r === 'refreshed' ? 'продлён' : 'продлить не удалось'}`);
    return { created: r === 'refreshed' ? 1 : 0, skipped: 0, hasMore: false };
  }
}
