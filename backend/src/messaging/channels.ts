/**
 * ТЗ 6.4 — каналы единого окна диалогов.
 *
 * Conversation.channel в БД — String, а не enum: заказчик подключает каналы
 * поэтапно (сейчас Telegram, дальше Chat Place / WhatsApp), и добавление
 * значения не должно требовать ALTER TYPE на живой колонке. Единственный
 * источник истины по значениям — этот файл.
 *
 * `outbound: false` означает, что канал пока только принимает сообщения:
 * интерфейс покажет переписку, но спрячет поле ответа, чтобы менеджер не
 * писал «в никуда». Как только появится адаптер отправки, флаг переключается
 * одной строкой.
 */
export interface ChannelOption {
  value: string;
  label: string;
  /** Умеет ли CRM отправлять в этот канал ответ. */
  outbound: boolean;
}

export const CHANNELS: readonly ChannelOption[] = [
  { value: 'TELEGRAM', label: 'Telegram', outbound: true },
  { value: 'WHATSAPP', label: 'WhatsApp', outbound: false },
  { value: 'INSTAGRAM', label: 'Instagram', outbound: false },
  { value: 'CHATPLACE', label: 'Chat Place', outbound: false },
  { value: 'OTHER', label: 'Другое', outbound: false },
] as const;

export const CHANNEL_VALUES: readonly string[] = CHANNELS.map((c) => c.value);

export const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

export function canSendTo(channel: string): boolean {
  return CHANNELS.find((c) => c.value === channel)?.outbound ?? false;
}
