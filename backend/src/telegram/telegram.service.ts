import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf | null = null;
  private chatId: string | null = null;

  constructor(config: ConfigService) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = config.get<string>('TELEGRAM_CHAT_ID');
    if (token && chatId) {
      try {
        this.bot = new Telegraf(token);
        this.chatId = chatId;
        this.logger.log('Telegram bot enabled');
      } catch (err) {
        this.logger.error('Telegram init failed', err as Error);
      }
    } else {
      this.logger.warn('Telegram disabled (no TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)');
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
}
