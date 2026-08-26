import { api } from './client';

/** Состояние привязки Telegram текущего сотрудника. */
export interface TelegramStatus {
  /** false — бот не настроен на сервере (нет токена). */
  enabled: boolean;
  linked: boolean;
  /** Имя аккаунта, к которому привязано («@ivan») — чтобы было видно, чей. */
  username: string | null;
}

export async function getTelegramStatus() {
  const { data } = await api.get<TelegramStatus>('/users/me/telegram');
  return data;
}

/**
 * Ссылки на бота с одноразовым кодом. Всё null — бот не настроен на сервере.
 *
 * Две ссылки, потому что домен t.me у таджикских провайдеров не резолвится
 * (NXDOMAIN даже через 8.8.8.8). `appUrl` открывает установленное приложение
 * мимо DNS, `webUrl` идёт на telegram.me — официальный алиас, который у
 * провайдера открывается.
 */
export interface TelegramLinkTargets {
  /** tg://resolve?domain=…&start=… — открывает приложение, DNS не нужен. */
  appUrl: string | null;
  /** https://telegram.me/…?start=… — запасной путь через браузер. */
  webUrl: string | null;
  /** Имя бота без @ — чтобы найти его поиском внутри Telegram. */
  botUsername: string | null;
  /** Старое поле, равно webUrl. Оставлено на время рассинхрона деплоев. */
  url: string | null;
}

export async function linkTelegram() {
  const { data } = await api.post<TelegramLinkTargets>('/users/me/telegram/link');
  return data;
}

export async function unlinkTelegram() {
  const { data } = await api.post<{ ok: boolean }>('/users/me/telegram/unlink');
  return data;
}
