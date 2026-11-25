/**
 * 29.10.2026 — Instagram и WhatsApp через приложения Meta: настройки.
 *
 * Каждый мессенджер включается тремя переменными окружения вместе. Все три
 * пустые — мессенджер выключен, CRM работает как раньше. Заполнена часть —
 * мессенджер считается «настроенным не полностью»: в логе ошибка, а в CRM
 * руководство видит, какой переменной не хватает. Сервер при этом НЕ падает
 * (в инструкции Meta-проекта он не стартовал): у нас одна боевая CRM на всех,
 * и опечатка в одной переменной не должна останавливать работу всего офиса.
 *
 * Ключи и секреты — только в переменных Railway. В журнал не пишутся.
 */

export const META_CHANNELS = ['INSTAGRAM', 'WHATSAPP'] as const;
export type MetaChannel = (typeof META_CHANNELS)[number];
export const isMetaChannel = (channel: string | null | undefined): channel is MetaChannel =>
  channel === 'INSTAGRAM' || channel === 'WHATSAPP';

export interface ChannelConfig {
  /** Все обязательные переменные заданы. */
  enabled: boolean;
  /** Чего не хватает, если заполнена только часть. Пусто — либо всё есть, либо ничего. */
  missing: string[];
  accountId: string;
  accessToken: string;
  appSecret: string;
  apiUrl: string;
}

const env = (name: string) => (process.env[name] ?? '').trim();

function channelConfig(vars: { account: string; token: string; secret: string }, apiUrlVar: string, apiUrlDefault: string): ChannelConfig {
  const values = { [vars.account]: env(vars.account), [vars.token]: env(vars.token), [vars.secret]: env(vars.secret) };
  const filled = Object.values(values).filter(Boolean).length;
  const missing = filled > 0 && filled < 3 ? Object.entries(values).filter(([, v]) => !v).map(([k]) => k) : [];
  return {
    enabled: filled === 3,
    missing,
    accountId: values[vars.account],
    accessToken: values[vars.token],
    appSecret: values[vars.secret],
    apiUrl: (env(apiUrlVar) || apiUrlDefault).replace(/\/+$/, ''),
  };
}

/**
 * 09.11.2026 — как подключён Instagram.
 *
 * 'unified' (по умолчанию) — «Instagram API с единым входом». С 30.10.2026 Meta
 * даёт новым приложениям только его: запросы идут на graph.facebook.com, ключ —
 * бессрочный ключ системного пользователя (продлевать не нужно), объект запросов —
 * id аккаунта Instagram (`/me` здесь — системный пользователь, а не аккаунт),
 * уведомления подписаны секретом самого приложения Meta (он и кладётся в
 * INSTAGRAM_APP_SECRET), аккаунт подписывают на уведомления запросом
 * POST /<id аккаунта>/subscribed_apps.
 *
 * 'instagram' — прежний «вход через Instagram» (graph.instagram.com, ключ на
 * 60 дней с ежедневным продлением, `/me`). Остался для приложений, созданных до
 * 30.10.2026: INSTAGRAM_LOGIN=instagram.
 */
export type InstagramLogin = 'unified' | 'instagram';
export const instagramLogin = (): InstagramLogin => (env('INSTAGRAM_LOGIN').toLowerCase() === 'instagram' ? 'instagram' : 'unified');

/** Поля уведомлений, на которые подписываем аккаунт при едином входе. */
export const INSTAGRAM_WEBHOOK_FIELDS = ['messages', 'messaging_seen', 'message_reactions', 'messaging_postbacks'];

export function instagramConfig(): ChannelConfig {
  return channelConfig(
    { account: 'INSTAGRAM_ACCOUNT_ID', token: 'INSTAGRAM_ACCESS_TOKEN', secret: 'INSTAGRAM_APP_SECRET' },
    'INSTAGRAM_API_URL',
    instagramLogin() === 'unified' ? 'https://graph.facebook.com/v26.0' : 'https://graph.instagram.com/v26.0',
  );
}

/**
 * 25.11.2026 — несколько аккаунтов Instagram (второй — @grant_china_tj).
 *
 * Первый — как и раньше INSTAGRAM_ACCOUNT_ID / _ACCESS_TOKEN / _APP_SECRET.
 * Следующие — INSTAGRAM_ACCOUNT_ID_2 … _5. Ключ и секрет у них необязательны:
 * если аккаунт выдан тому же системному пользователю (то же бизнес-портфолио)
 * и тому же приложению Meta, подходят ключ и секрет первого. Аккаунт из
 * другого портфолио — свой INSTAGRAM_ACCESS_TOKEN_2; из другого приложения
 * Meta — ещё и свой INSTAGRAM_APP_SECRET_2 (им подписаны его уведомления).
 */
export interface InstagramAccount {
  accountId: string;
  accessToken: string;
  appSecret: string;
  /** Первый аккаунт: его ключ продлевается (прежний вход), к нему относятся старые чаты без accountId. */
  primary: boolean;
}

export const MAX_INSTAGRAM_ACCOUNTS = 5;

export function instagramAccounts(): InstagramAccount[] {
  const main = instagramConfig();
  if (!main.enabled) return [];
  const list: InstagramAccount[] = [{ accountId: main.accountId, accessToken: main.accessToken, appSecret: main.appSecret, primary: true }];
  for (let i = 2; i <= MAX_INSTAGRAM_ACCOUNTS; i++) {
    const id = env(`INSTAGRAM_ACCOUNT_ID_${i}`);
    if (!id || list.some((a) => a.accountId === id)) continue;
    list.push({
      accountId: id,
      accessToken: env(`INSTAGRAM_ACCESS_TOKEN_${i}`) || main.accessToken,
      appSecret: env(`INSTAGRAM_APP_SECRET_${i}`) || main.appSecret,
      primary: false,
    });
  }
  return list;
}

/** Аккаунт чата. accountId пустой (чаты до 29.10.2026) — первый аккаунт; неизвестный — null. */
export function instagramAccount(accountId?: string | null): InstagramAccount | null {
  const all = instagramAccounts();
  if (!accountId) return all[0] ?? null;
  return all.find((a) => a.accountId === accountId) ?? null;
}

/** Секреты, которыми может быть подписано уведомление Instagram (без повторов). */
export const instagramAppSecrets = (): string[] => [...new Set(instagramAccounts().map((a) => a.appSecret).filter(Boolean))];

export function whatsappConfig(): ChannelConfig {
  return channelConfig(
    { account: 'WHATSAPP_PHONE_NUMBER_ID', token: 'WHATSAPP_ACCESS_TOKEN', secret: 'WHATSAPP_APP_SECRET' },
    'WHATSAPP_API_URL',
    'https://graph.facebook.com/v25.0',
  );
}

export function configFor(channel: MetaChannel): ChannelConfig {
  return channel === 'INSTAGRAM' ? instagramConfig() : whatsappConfig();
}

/** Одно и то же случайное слово вписывается в оба приложения Meta. */
export const metaVerifyToken = () => env('META_VERIFY_TOKEN');

/**
 * Публичный HTTPS-адрес API: из него собирается ссылка, по которой Meta
 * скачивает наши исходящие файлы. По умолчанию — боевой Railway.
 */
export const publicApiUrl = () => (env('PUBLIC_API_URL') || 'https://grantchina-production.up.railway.app').replace(/\/+$/, '');

/** Пределы Meta на текст: Instagram — 1000 байт, WhatsApp — 4096. Считаются БАЙТЫ UTF-8. */
export const TEXT_LIMIT_BYTES: Record<MetaChannel, number> = { INSTAGRAM: 1000, WHATSAPP: 4096 };

/** Окно ответа: обычное сообщение — только в течение суток после последнего сообщения клиента. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const MB = 1024 * 1024;
/** Наши пределы на исходящие файлы (повторены в CRM, utils/chatLimits.ts). */
export const OUTGOING_LIMITS = {
  imageInstagram: 8 * MB,
  imageWhatsapp: 5 * MB,
  pdf: 25 * MB,
  // 09.11.2026 — видео: пределы самих мессенджеров (Instagram — 25 МБ, WhatsApp — 16 МБ).
  videoInstagram: 25 * MB,
  videoWhatsapp: 16 * MB,
  voice: 10 * MB,
  voiceSeconds: 300,
};
/** Предел на скачивание входящих файлов с серверов Meta. */
export const INCOMING_FILE_LIMIT = 30 * MB;
