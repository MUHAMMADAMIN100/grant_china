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

/** Возвращает ссылку на бота с одноразовым кодом. url=null — бот не настроен. */
export async function linkTelegram() {
  const { data } = await api.post<{ url: string | null }>('/users/me/telegram/link');
  return data;
}

export async function unlinkTelegram() {
  const { data } = await api.post<{ ok: boolean }>('/users/me/telegram/unlink');
  return data;
}
