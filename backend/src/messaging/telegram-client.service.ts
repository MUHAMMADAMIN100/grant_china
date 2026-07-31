import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ТЗ 6.4 — КЛИЕНТСКИЙ Telegram-бот единого окна.
 *
 * РЕШЕНИЕ ЗАКАЗЧИКА: отдельный бот, не тот, что шлёт уведомления сотрудникам
 * и постит программы в канал. Разделение осознанное: у служебного бота другой
 * смысл и другая аудитория, а смешение привело бы к тому, что переписка
 * клиентов и внутренние уведомления идут через один аккаунт.
 *
 * Отдельный сервис, а не расширение TelegramService, ровно по той же причине:
 * у них разные токены, разные адресаты и разная ответственность.
 *
 * Реализация на fetch, а не на Telegraf: нужны ровно три метода Bot API
 * (setWebhook, sendMessage, getFile), а Telegraf в этом модуле тянул бы за
 * собой long-polling, который конфликтует с вебхуком. Тот же приём, что у
 * MailService (Brevo) и SmsService — внешний REST через fetch.
 */
@Injectable()
export class TelegramClientBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramClientBotService.name);
  private readonly token: string | null;
  private readonly webhookSecret: string | null;
  private readonly publicBase: string | null;

  constructor(config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_CLIENT_BOT_TOKEN') || null;
    this.webhookSecret = config.get<string>('TELEGRAM_CLIENT_WEBHOOK_SECRET') || null;
    this.publicBase = (config.get<string>('PUBLIC_API_BASE') || '').replace(/\/+$/, '') || null;

    if (!this.token) {
      this.logger.warn('Клиентский Telegram-бот отключён (нет TELEGRAM_CLIENT_BOT_TOKEN)');
    } else if (!this.webhookSecret) {
      this.logger.error(
        'TELEGRAM_CLIENT_BOT_TOKEN задан, но TELEGRAM_CLIENT_WEBHOOK_SECRET — нет. ' +
          'Вебхук НЕ будет зарегистрирован: без секрета его эндпоинт принимал бы запросы от кого угодно.',
      );
    }
  }

  isEnabled(): boolean {
    return Boolean(this.token);
  }

  /** Совпадает ли секрет из заголовка вебхука с настроенным. */
  verifySecret(secret: string | undefined): boolean {
    return Boolean(this.webhookSecret && secret && secret === this.webhookSecret);
  }

  /**
   * Регистрирует вебхук при старте. Идемпотентно: Telegram принимает повторный
   * setWebhook с тем же URL как no-op, поэтому рестарт контейнера ничего не
   * ломает.
   *
   * .catch() ОБЯЗАТЕЛЕН: без него сетевая ошибка при старте (Railway ещё не
   * поднял сеть, Telegram недоступен) превратилась бы в unhandled rejection и
   * уронила процесс в рестарт-луп из-за необязательной интеграции — та же
   * ошибка, что уже разобрана в applications.service.onModuleInit.
   */
  async onModuleInit(): Promise<void> {
    if (!this.token || !this.webhookSecret) return;
    if (!this.publicBase) {
      this.logger.warn(
        'Клиентский Telegram-бот: не задан PUBLIC_API_BASE — вебхук не зарегистрирован. ' +
          'Укажите внешний URL бэкенда, иначе Telegram не будет знать, куда доставлять сообщения.',
      );
      return;
    }
    const url = `${this.publicBase}/api/messaging/webhook/telegram`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          secret_token: this.webhookSecret,
          // Нас интересуют только сообщения — не нужны опросы, инлайн-режим и пр.
          allowed_updates: ['message'],
          drop_pending_updates: false,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (data?.ok) {
        this.logger.log(`Клиентский Telegram-бот: вебхук зарегистрирован на ${url}`);
      } else {
        this.logger.error(`Клиентский Telegram-бот: setWebhook отклонён — ${JSON.stringify(data)}`);
      }
    } catch (e) {
      this.logger.error(
        `Клиентский Telegram-бот: не удалось зарегистрировать вебхук (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  /** Отправляет ответ клиенту. Возвращает message_id или null. */
  async sendMessage(chatId: string, text: string): Promise<string | null> {
    if (!this.token) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (data?.ok && data?.result?.message_id) return String(data.result.message_id);
      this.logger.warn(`Telegram sendMessage → ${chatId}: ${JSON.stringify(data)}`);
      return null;
    } catch (e) {
      this.logger.error(`Telegram sendMessage failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Ссылка на файл вложения у Telegram. Файлы НЕ скачиваются в /uploads
   * намеренно: клиент может прислать что угодно и сколько угодно, и хранение
   * этого потока — отдельное решение Основателя (та же логика, что у записей
   * разговоров в Call.recordingUrl).
   *
   * ВНИМАНИЕ: ссылка содержит токен бота, поэтому отдаётся только сотрудникам
   * CRM за авторизацией и никогда не логируется.
   */
  async getFileUrl(fileId: string): Promise<string | null> {
    if (!this.token) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const data: any = await res.json().catch(() => ({}));
      if (data?.ok && data?.result?.file_path) {
        return `https://api.telegram.org/file/bot${this.token}/${data.result.file_path}`;
      }
      return null;
    } catch {
      return null;
    }
  }
}
