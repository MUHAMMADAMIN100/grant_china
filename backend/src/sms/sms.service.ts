import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Provider = 'smsru' | 'twilio' | 'none';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private provider: Provider = 'none';

  // SMS.ru
  private smsruApiId: string | null = null;
  private smsruFrom: string | null = null;

  // Twilio
  private twilioSid: string | null = null;
  private twilioToken: string | null = null;
  private twilioFrom: string | null = null;

  constructor(private config: ConfigService) {
    const raw = (config.get<string>('SMS_PROVIDER') || '').toLowerCase().trim();

    if (raw === 'smsru') {
      this.smsruApiId = config.get<string>('SMSRU_API_ID') || null;
      this.smsruFrom = config.get<string>('SMS_FROM') || null;
      if (this.smsruApiId) {
        this.provider = 'smsru';
        this.logger.log(`SMS enabled (SMS.ru, from=${this.smsruFrom || 'default'})`);
      } else {
        this.logger.warn('SMS_PROVIDER=smsru but SMSRU_API_ID is missing — SMS disabled');
      }
    } else if (raw === 'twilio') {
      this.twilioSid = config.get<string>('TWILIO_ACCOUNT_SID') || null;
      this.twilioToken = config.get<string>('TWILIO_AUTH_TOKEN') || null;
      this.twilioFrom = config.get<string>('TWILIO_FROM') || null;
      if (this.twilioSid && this.twilioToken && this.twilioFrom) {
        this.provider = 'twilio';
        this.logger.log(`SMS enabled (Twilio, from=${this.twilioFrom})`);
      } else {
        this.logger.warn(
          'SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM missing — SMS disabled',
        );
      }
    } else {
      this.logger.warn('SMS disabled (SMS_PROVIDER not set; expected smsru | twilio)');
    }
  }

  /** Нормализуем номер: оставляем + и цифры. */
  private normalize(phone: string): string {
    return phone.replace(/[^\d+]/g, '');
  }

  async send(phone: string, message: string): Promise<boolean> {
    if (this.provider === 'none') return false;
    const to = this.normalize(phone);
    if (!to) {
      this.logger.warn('SMS skipped: empty phone');
      return false;
    }

    try {
      if (this.provider === 'smsru') {
        return await this.sendSmsRu(to, message);
      }
      if (this.provider === 'twilio') {
        return await this.sendTwilio(to, message);
      }
    } catch (err) {
      this.logger.error(`SMS send failed (${this.provider}): ${(err as Error).message}`);
    }
    return false;
  }

  /** SMS.ru — простой JSON API. https://sms.ru/api/send */
  private async sendSmsRu(to: string, text: string): Promise<boolean> {
    const url = new URL('https://sms.ru/sms/send');
    url.searchParams.set('api_id', this.smsruApiId!);
    url.searchParams.set('to', to.replace(/^\+/, ''));
    url.searchParams.set('msg', text);
    url.searchParams.set('json', '1');
    if (this.smsruFrom) url.searchParams.set('from', this.smsruFrom);

    const res = await fetch(url, { method: 'GET' });
    const data: any = await res.json().catch(() => ({}));
    if (data?.status === 'OK') {
      this.logger.log(`SMS.ru → ${to}: ok (balance=${data.balance ?? '?'})`);
      return true;
    }
    this.logger.warn(`SMS.ru → ${to}: ${JSON.stringify(data)}`);
    return false;
  }

  /** Twilio Messages API. https://api.twilio.com/2010-04-01/Accounts/{Sid}/Messages.json */
  private async sendTwilio(to: string, body: string): Promise<boolean> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.twilioSid}/Messages.json`;
    const auth = Buffer.from(`${this.twilioSid}:${this.twilioToken}`).toString('base64');
    const form = new URLSearchParams();
    form.set('To', to.startsWith('+') ? to : `+${to}`);
    form.set('From', this.twilioFrom!);
    form.set('Body', body);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (res.ok) {
      this.logger.log(`Twilio → ${to}: queued`);
      return true;
    }
    const errBody = await res.text().catch(() => '');
    this.logger.warn(`Twilio → ${to}: ${res.status} ${errBody}`);
    return false;
  }
}
