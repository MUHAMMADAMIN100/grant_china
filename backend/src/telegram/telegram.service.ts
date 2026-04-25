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

  /** Возвращает message_id или null */
  async sendToChannel(message: string): Promise<number | null> {
    if (!this.bot || !this.channelId) return null;
    try {
      const res = await this.bot.telegram.sendMessage(this.channelId, message, {
        parse_mode: 'Markdown',
      });
      return res.message_id;
    } catch (err) {
      this.logger.error('Telegram channel send failed', err as Error);
      return null;
    }
  }

  /** Возвращает message_id или null. Если фото не ушло — фоллбэк на текст. */
  async sendPhotoToChannel(
    photoUrl: string,
    caption: string,
  ): Promise<{ messageId: number; hasPhoto: boolean } | null> {
    if (!this.bot || !this.channelId) return null;
    try {
      const res = await this.bot.telegram.sendPhoto(this.channelId, photoUrl, {
        caption,
        parse_mode: 'Markdown',
      });
      return { messageId: res.message_id, hasPhoto: true };
    } catch (err) {
      this.logger.error('Telegram channel photo send failed', err as Error);
      const id = await this.sendToChannel(caption);
      return id ? { messageId: id, hasPhoto: false } : null;
    }
  }

  private describeErr(err: unknown): string {
    const e = err as any;
    return [
      e?.code,
      e?.response?.error_code,
      e?.response?.description,
      e?.message,
    ]
      .filter(Boolean)
      .join(' | ');
  }

  async editChannelText(messageId: number, message: string) {
    if (!this.bot || !this.channelId) return false;
    try {
      await this.bot.telegram.editMessageText(
        this.channelId,
        messageId,
        undefined,
        message,
        { parse_mode: 'Markdown' },
      );
      return true;
    } catch (err) {
      this.logger.warn(`Telegram editText failed: ${this.describeErr(err)}`);
      return false;
    }
  }

  async editChannelCaption(messageId: number, caption: string) {
    if (!this.bot || !this.channelId) return false;
    try {
      await this.bot.telegram.editMessageCaption(
        this.channelId,
        messageId,
        undefined,
        caption,
        { parse_mode: 'Markdown' },
      );
      return true;
    } catch (err) {
      this.logger.warn(`Telegram editCaption failed: ${this.describeErr(err)}`);
      return false;
    }
  }

  async editChannelMedia(messageId: number, photoUrl: string, caption: string) {
    if (!this.bot || !this.channelId) return false;
    try {
      await this.bot.telegram.editMessageMedia(this.channelId, messageId, undefined, {
        type: 'photo',
        media: photoUrl,
        caption,
        parse_mode: 'Markdown',
      });
      return true;
    } catch (err) {
      this.logger.warn(`Telegram editMedia failed: ${this.describeErr(err)}`);
      return false;
    }
  }

  async deleteChannelMessage(messageId: number) {
    if (!this.bot || !this.channelId) return false;
    try {
      await this.bot.telegram.deleteMessage(this.channelId, messageId);
      return true;
    } catch (err) {
      this.logger.warn(`Telegram deleteMessage failed: ${this.describeErr(err)}`);
      return false;
    }
  }
}
