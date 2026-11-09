import { Injectable } from '@nestjs/common';
import { InstagramApi, MetaTokensService } from '../../messaging/meta/meta.api';
import { instagramConfig, instagramLogin } from '../../messaging/meta/meta.config';
import { MetaApiError } from '../../messaging/meta/meta.http';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';

/**
 * Уход за подключением Instagram, раз в 6 часов. Без настроенного Instagram
 * джоба ничего не делает.
 *
 * Единый вход (09.11.2026, по умолчанию): ключ бессрочный, продлевать нечего —
 * проверяем, что аккаунт подписан на уведомления приложения, и подписываем,
 * если подписка слетела (без неё сообщения клиентов в CRM не приходят).
 *
 * Вход через Instagram (29.10.2026): ключ живёт 60 дней и продлевается обменом
 * на свежий — не чаще раза в 20 часов и только когда до конца срока меньше
 * 30 дней (или срок ещё неизвестен).
 */
@Injectable()
export class InstagramTokenJob implements ScheduledJob {
  readonly name = 'instagram-token';
  readonly everyMinutes = 360;

  constructor(
    private tokens: MetaTokensService,
    private ig: InstagramApi,
  ) {}

  async run(ctx: JobContext): Promise<JobResult> {
    if (instagramLogin() === 'unified') {
      if (!instagramConfig().enabled) return { created: 0, skipped: 0, hasMore: false };
      try {
        const r = await this.ig.ensureSubscribed();
        if (r === 'subscribed') ctx.logger.log('Instagram: аккаунт подписан на уведомления');
        return { created: r === 'subscribed' ? 1 : 0, skipped: 0, hasMore: false };
      } catch (e) {
        const err = e as MetaApiError;
        ctx.logger.warn(`Instagram: подписку на уведомления проверить не удалось: ${err.reason ?? ''} ${err.detail ?? ''}`.trim());
        if (err.reason === 'TOKEN_INVALID') await this.tokens.markRefused('INSTAGRAM');
        return { created: 0, skipped: 0, hasMore: false };
      }
    }
    const r = await this.tokens.refreshInstagramToken(ctx.now);
    if (r !== 'disabled' && r !== 'skipped') ctx.logger.log(`Ключ Instagram: ${r === 'refreshed' ? 'продлён' : 'продлить не удалось'}`);
    return { created: r === 'refreshed' ? 1 : 0, skipped: 0, hasMore: false };
  }
}
