import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf | null = null;
  private chatId: string | null = null;
  private channelId: string | null = null;

  constructor(config: ConfigService) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = config.get<string>('TELEGRAM_CHAT_ID');
    const channelId = config.get<string>('TELEGRAM_CHANNEL_ID');
    if (token) {
      try {
        this.bot = new Telegraf(token);
        this.chatId = chatId || null;
        this.channelId = channelId || null;
        this.logger.log(
          `Telegram bot enabled (chat=${!!chatId}, channel=${!!channelId})`,
        );
      } catch (err) {
        this.logger.error('Telegram init failed', err as Error);
      }
    } else {
      this.logger.warn('Telegram disabled (no TELEGRAM_BOT_TOKEN)');
    }
  }

  async send(message: string) {
    if (!this.bot || !this.chatId) return;
    try {
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      this.logger.error('Telegram send failed', err as Error);
    }
  }

  async sendToChannel(message: string) {
    if (!this.bot || !this.channelId) return;
    try {
      await this.bot.telegram.sendMessage(this.channelId, message, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      this.logger.error('Telegram channel send failed', err as Error);
    }
  }

  async sendPhotoToChannel(photoUrl: string, caption: string) {
    if (!this.bot || !this.channelId) return;
    try {
      await this.bot.telegram.sendPhoto(this.channelId, photoUrl, {
        caption,
        parse_mode: 'Markdown',
      });
    } catch (err) {
      this.logger.error('Telegram channel photo send failed', err as Error);
      // Фоллбэк: отправим текстом без фото
      await this.sendToChannel(caption).catch(() => undefined);
    }
  }
}
