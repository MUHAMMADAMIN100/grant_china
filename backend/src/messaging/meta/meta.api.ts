import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INSTAGRAM_WEBHOOK_FIELDS, instagramConfig, instagramLogin, whatsappConfig, type MetaChannel } from './meta.config';
import { graphRequest, MetaApiError, tokenFingerprint } from './meta.http';

/**
 * 29.10.2026 — ключи Meta и их состояние (инструкция, шаг 7).
 *
 * IntegrationState:
 *  - instagramToken: { token, expiresAt, fingerprint, refreshedAt } — продлённый
 *    ключ Instagram. fingerprint — отпечаток ключа ИЗ ОКРУЖЕНИЯ, от которого он
 *    получен: если в Railway положили другой ключ, отпечаток не совпадёт и мы
 *    возьмём новый ключ из окружения, а не старый из базы.
 *  - instagramStatus / whatsappStatus: { refused: true, fingerprint } — Meta
 *    ответила 190 «ключ не действует». Первая удачная отправка снимает отметку,
 *    новый ключ в окружении сбрасывает её сам.
 */
@Injectable()
export class MetaTokensService {
  private readonly logger = new Logger(MetaTokensService.name);

  constructor(private prisma: PrismaService) {}

  private async getState<T>(key: string): Promise<T | null> {
    const row = await this.prisma.integrationState.findUnique({ where: { key } });
    return (row?.value as T) ?? null;
  }

  private async setState(key: string, value: Record<string, unknown>) {
    await this.prisma.integrationState.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
  }

  async instagramToken(): Promise<string> {
    const envToken = instagramConfig().accessToken;
    const st = await this.getState<{ token: string; fingerprint: string }>('instagramToken');
    if (st?.token && st.fingerprint === tokenFingerprint(envToken)) return st.token;
    return envToken;
  }

  whatsappToken(): string {
    return whatsappConfig().accessToken;
  }

  async markRefused(channel: MetaChannel) {
    const envToken = channel === 'INSTAGRAM' ? instagramConfig().accessToken : whatsappConfig().accessToken;
    await this.setState(channel === 'INSTAGRAM' ? 'instagramStatus' : 'whatsappStatus', {
      refused: true,
      fingerprint: tokenFingerprint(envToken),
      at: new Date().toISOString(),
    });
  }

  /** true — отметка «ключ отказан» стояла и снята (ключ снова работает). */
  async clearRefused(channel: MetaChannel): Promise<boolean> {
    const key = channel === 'INSTAGRAM' ? 'instagramStatus' : 'whatsappStatus';
    const st = await this.getState<{ refused?: boolean }>(key);
    if (!st?.refused) return false;
    await this.setState(key, { refused: false, at: new Date().toISOString() });
    return true;
  }

  async isRefused(channel: MetaChannel): Promise<boolean> {
    const envToken = channel === 'INSTAGRAM' ? instagramConfig().accessToken : whatsappConfig().accessToken;
    const st = await this.getState<{ refused?: boolean; fingerprint?: string }>(channel === 'INSTAGRAM' ? 'instagramStatus' : 'whatsappStatus');
    return !!st?.refused && st.fingerprint === tokenFingerprint(envToken);
  }

  /**
   * Ежедневное продление ключа Instagram (джоба instagram-token). Меняем, когда
   * до конца срока меньше 30 дней или срок ещё неизвестен (ключ из окружения),
   * и не чаще раза в 20 часов. Адрес запроса содержит ключ (так требует Meta) —
   * поэтому в журнал он не пишется.
   */
  async refreshInstagramToken(now = new Date()): Promise<'refreshed' | 'skipped' | 'disabled' | 'failed'> {
    const cfg = instagramConfig();
    if (!cfg.enabled) return 'disabled';
    // Единый вход: ключ системного пользователя бессрочный, продлевать нечего.
    // Запрос продления на graph.instagram.com он не пройдёт и был бы ошибочно
    // отмечен «ключ не действует».
    if (instagramLogin() === 'unified') return 'skipped';
    const fp = tokenFingerprint(cfg.accessToken);
    const st = await this.getState<{ token: string; fingerprint: string; expiresAt?: string; attemptAt?: string }>('instagramToken');
    const sameEnv = st?.fingerprint === fp;
    if (sameEnv && st?.attemptAt && now.getTime() - new Date(st.attemptAt).getTime() < 20 * 3600_000) return 'skipped';
    if (sameEnv && st?.expiresAt && new Date(st.expiresAt).getTime() - now.getTime() > 30 * 86400_000) return 'skipped';
    const current = sameEnv && st?.token ? st.token : cfg.accessToken;
    const base = cfg.apiUrl.replace(/\/v\d+(\.\d+)?$/, '');
    try {
      const res = await graphRequest<{ access_token: string; expires_in: number }>(
        'INSTAGRAM',
        `${base}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`,
      );
      await this.setState('instagramToken', {
        token: res.access_token,
        fingerprint: fp,
        expiresAt: new Date(now.getTime() + res.expires_in * 1000).toISOString(),
        refreshedAt: now.toISOString(),
        attemptAt: now.toISOString(),
      });
      await this.clearRefused('INSTAGRAM');
      return 'refreshed';
    } catch (e) {
      const err = e as MetaApiError;
      this.logger.warn(`Продление ключа Instagram не удалось: ${err.reason ?? ''} ${err.detail ?? ''}`.trim());
      await this.setState('instagramToken', { ...(st && sameEnv ? st : { fingerprint: fp }), attemptAt: now.toISOString() });
      if (err.reason === 'TOKEN_INVALID') await this.markRefused('INSTAGRAM');
      return 'failed';
    }
  }

  async instagramTokenExpiresAt(): Promise<string | null> {
    const st = await this.getState<{ fingerprint: string; expiresAt?: string }>('instagramToken');
    return st?.expiresAt && st.fingerprint === tokenFingerprint(instagramConfig().accessToken) ? st.expiresAt : null;
  }
}

/**
 * Запросы к Instagram API. Два способа подключения (meta.config, instagramLogin):
 * единый вход — graph.facebook.com и id аккаунта в адресе; вход через
 * Instagram — graph.instagram.com и `/me`.
 */
@Injectable()
export class InstagramApi {
  constructor(private tokens: MetaTokensService) {}

  private async call<T>(pathAndQuery: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
    return graphRequest<T>('INSTAGRAM', `${instagramConfig().apiUrl}${pathAndQuery}`, { ...init, token: await this.tokens.instagramToken() });
  }

  /** Узел аккаунта: при едином входе `/me` — системный пользователь, поэтому id из INSTAGRAM_ACCOUNT_ID. */
  private accountNode(): string {
    return instagramLogin() === 'unified' ? `/${encodeURIComponent(instagramConfig().accountId)}` : '/me';
  }

  /** Аккаунт, от имени которого работает CRM: id и @имя. */
  async account(): Promise<{ id: string | null; username: string | null }> {
    if (instagramLogin() === 'unified') {
      const r = await this.call<{ id?: string; username?: string }>(`${this.accountNode()}?fields=id,username`);
      return { id: r.id ?? null, username: r.username ?? null };
    }
    const r = await this.call<{ user_id?: string; id?: string; username?: string }>('/me?fields=user_id,username');
    return { id: r.user_id ?? r.id ?? null, username: r.username ?? null };
  }

  /**
   * Единый вход: аккаунты Instagram, выданные ключу. Нужны, когда в
   * INSTAGRAM_ACCOUNT_ID записан не тот id, — CRM подскажет правильный.
   */
  assignedAccounts() {
    return this.call<{ data?: Array<{ id: string; username?: string }> }>('/me/assigned_instagram_accounts?fields=id,username');
  }

  profile(contactId: string) {
    return this.call<{ name?: string; username?: string; profile_pic?: string }>(`/${encodeURIComponent(contactId)}?fields=name,username,profile_pic`);
  }

  sendText(contactId: string, text: string) {
    return this.call<{ message_id?: string }>(`${this.accountNode()}/messages`, { method: 'POST', body: { recipient: { id: contactId }, message: { text } } });
  }

  sendAttachment(contactId: string, type: 'image' | 'audio' | 'video' | 'file', url: string) {
    return this.call<{ message_id?: string }>(`${this.accountNode()}/messages`, {
      method: 'POST',
      body: { recipient: { id: contactId }, message: { attachment: { type, payload: { url } } } },
    });
  }

  /**
   * Единый вход: сам аккаунт уведомлений не шлёт, пока его не подписали на
   * приложение (POST /<id>/subscribed_apps). Повтор безвреден, поэтому
   * проверяем при запуске и раз в 6 часов (джоба instagram-token). Если Meta
   * не примет часть полей — подписываем хотя бы на сообщения.
   */
  async ensureSubscribed(): Promise<'subscribed' | 'already' | 'not-needed'> {
    if (instagramLogin() !== 'unified') return 'not-needed';
    const node = `${this.accountNode()}/subscribed_apps`;
    const current = await this.call<{ data?: Array<{ subscribed_fields?: string[] }> }>(node);
    if (current.data?.some((app) => app.subscribed_fields?.includes('messages'))) return 'already';
    try {
      await this.call(node, { method: 'POST', body: { subscribed_fields: INSTAGRAM_WEBHOOK_FIELDS.join(',') } });
    } catch (e) {
      if (!(e instanceof MetaApiError) || e.reason === 'TOKEN_INVALID' || e.reason === 'NETWORK') throw e;
      await this.call(node, { method: 'POST', body: { subscribed_fields: 'messages' } });
    }
    return 'subscribed';
  }
}

/** Запросы к WhatsApp Cloud API. */
@Injectable()
export class WhatsAppApi {
  constructor(private tokens: MetaTokensService) {}

  private call<T>(pathAndQuery: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
    return graphRequest<T>('WHATSAPP', `${whatsappConfig().apiUrl}${pathAndQuery}`, { ...init, token: this.tokens.whatsappToken() });
  }

  phoneInfo() {
    return this.call<{ display_phone_number?: string; verified_name?: string }>(
      `/${encodeURIComponent(whatsappConfig().accountId)}?fields=display_phone_number,verified_name`,
    );
  }

  private send(to: string, payload: Record<string, unknown>) {
    return this.call<{ messages?: Array<{ id: string }> }>(`/${encodeURIComponent(whatsappConfig().accountId)}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload },
    });
  }

  sendText(to: string, body: string) {
    return this.send(to, { type: 'text', text: { body, preview_url: false } });
  }
  sendImage(to: string, link: string) {
    return this.send(to, { type: 'image', image: { link } });
  }
  sendDocument(to: string, link: string, filename: string) {
    return this.send(to, { type: 'document', document: { link, filename } });
  }
  sendVoice(to: string, link: string) {
    return this.send(to, { type: 'audio', audio: { link, voice: true } });
  }
  sendLocation(to: string, latitude: number, longitude: number, name?: string | null, address?: string | null) {
    return this.send(to, { type: 'location', location: { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) } });
  }

  /** Файлы WhatsApp — в два запроса: сначала адрес по id, потом сам файл (тоже с ключом). */
  mediaInfo(mediaId: string) {
    return this.call<{ url: string; mime_type?: string; file_size?: number }>(`/${encodeURIComponent(mediaId)}`);
  }
}
