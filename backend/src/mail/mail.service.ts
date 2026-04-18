import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private from: string;
  private adminEmail: string | null;

  constructor(private config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const port = parseInt(config.get<string>('SMTP_PORT') || '587', 10);
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASSWORD');
    this.from = config.get<string>('SMTP_FROM') || 'GrantChina <noreply@grantchina.local>';
    this.adminEmail = config.get<string>('ADMIN_EMAIL') || null;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`Mail enabled (${host}:${port})`);
    } else {
      this.logger.warn('Mail disabled (SMTP credentials not configured)');
    }
  }

  async send(to: string, subject: string, html: string) {
    if (!this.transporter) return;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
    } catch (err) {
      this.logger.error('Mail send failed', err as Error);
    }
  }

  async sendToAdmin(subject: string, html: string) {
    if (!this.adminEmail) return;
    return this.send(this.adminEmail, subject, html);
  }
}
