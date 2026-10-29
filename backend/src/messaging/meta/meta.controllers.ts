import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { Direction } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { fixFilenameEncoding } from '../../common/upload-utils';
import { configFor, metaVerifyToken, OUTGOING_LIMITS, type MetaChannel } from './meta.config';
import { parseInstagramWebhook, parseWhatsAppWebhook } from './meta.parsers';
import { MetaChatsService } from './meta-chats.service';

export class SendLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
}

export class RetryMessageDto {
  @IsOptional() @IsString() @MaxLength(20000) text?: string;
}

export class ChatApplicationDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsString() @MinLength(5) @MaxLength(30) phone!: string;
  @IsEnum(Direction) direction!: Direction;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

/** Подпись Meta: HMAC-SHA256 СЫРЫХ байт тела секретом приложения (не разобранного JSON). */
export function signedByMeta(body: Buffer | undefined, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !body || !signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Форма уведомления без значений — для журнала, когда из него ничего не прочиталось. */
function shapeOf(v: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1)] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).slice(0, 20).map((k) => [k, shapeOf((v as any)[k], depth + 1)]));
  return typeof v;
}

/**
 * 29.10.2026 — адреса уведомлений Meta. Без входа (их зовёт Meta), без
 * ограничения частоты (Meta шлёт пачками и повторяет). Защита — подпись.
 */
@SkipThrottle()
@Controller('messaging/webhook')
export class MetaWebhooksController {
  private readonly logger = new Logger('MetaWebhook');

  constructor(private chats: MetaChatsService) {}

  private verify(mode: string, token: string, challenge: string, res: Response) {
    const expected = metaVerifyToken();
    if (mode !== 'subscribe' || !expected || token !== expected || !challenge) throw new ForbiddenException();
    res.type('text/plain').send(challenge);
  }

  @Get('instagram')
  verifyInstagram(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    this.verify(mode, token, challenge, res);
  }

  @Get('whatsapp')
  verifyWhatsapp(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    this.verify(mode, token, challenge, res);
  }

  private async handle(channel: MetaChannel, req: RawBodyRequest<Request>, signature: string | undefined) {
    const cfg = configFor(channel);
    if (!signedByMeta(req.rawBody, signature, cfg.appSecret)) throw new UnauthorizedException('Неверная подпись');
    const body = req.body;
    const { events, skipped } = channel === 'INSTAGRAM' ? parseInstagramWebhook(body) : parseWhatsAppWebhook(body);
    if (!events.length && skipped) this.logger.warn(`${channel}: ничего не прочиталось, форма: ${JSON.stringify(shapeOf(body))}`);
    if (!cfg.enabled) {
      this.logger.warn(`${channel}: уведомление пришло, но канал не настроен полностью — пропущено`);
      return { ok: true };
    }
    const r = await this.chats.receive(channel, events);
    this.logger.log(`${channel}: событий ${events.length}, записано ${r.processed}, чужих ${r.foreign}, пропущено ${skipped}`);
    return { ok: true };
  }

  @Post('instagram')
  @HttpCode(200)
  instagram(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    return this.handle('INSTAGRAM', req, signature);
  }

  @Post('whatsapp')
  @HttpCode(200)
  whatsapp(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    return this.handle('WHATSAPP', req, signature);
  }
}

/** Действия сотрудника в чатах Instagram / WhatsApp. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('messaging')
export class MetaChatsController {
  constructor(private chats: MetaChatsService) {}

  @Post('conversations/:id/files')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: OUTGOING_LIMITS.pdf + 1 } }))
  sendFile(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) {
    // Multer отдаёт имя файла в latin1: «Договор.pdf» в CRM и у клиента в WhatsApp превращался в «Ð”Ð¾Ð³…».
    return this.chats.sendFile(id, file && { buffer: file.buffer, size: file.size, originalname: fixFilenameEncoding(file.originalname) }, user);
  }

  @Post('conversations/:id/voice')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: OUTGOING_LIMITS.voice + 1 } }))
  sendVoice(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) {
    return this.chats.sendVoice(id, file, user);
  }

  @Post('conversations/:id/location')
  sendLocation(@Param('id') id: string, @Body() dto: SendLocationDto, @CurrentUser() user: any) {
    return this.chats.sendLocation(id, dto, user);
  }

  @Post('messages/:id/retry')
  retry(@Param('id') id: string, @Body() dto: RetryMessageDto, @CurrentUser() user: any) {
    return this.chats.retry(id, dto.text, user);
  }

  @Post('conversations/:id/take')
  take(@Param('id') id: string, @CurrentUser() user: any) {
    return this.chats.take(id, user);
  }

  @Post('conversations/:id/release')
  release(@Param('id') id: string, @CurrentUser() user: any) {
    return this.chats.release(id, user);
  }

  @Post('conversations/:id/application')
  createApplication(@Param('id') id: string, @Body() dto: ChatApplicationDto, @CurrentUser() user: any) {
    return this.chats.createApplication(id, dto, user);
  }

  @Get('attachments/:id')
  async attachment(@Param('id') id: string, @Res() res: Response) {
    const f = await this.chats.attachmentFile(id);
    if (f.mime) res.type(f.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (f.name) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(f.path, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }

  @Get('conversations/:id/picture')
  async picture(@Param('id') id: string, @Res() res: Response) {
    const p = await this.chats.pictureFile(id);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(p, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}

/**
 * Без входа: наши ОТПРАВЛЕННЫЕ файлы, которые Meta забирает по ссылке.
 * Только отмеченные isPublic, под случайными именами — больше ничего.
 */
@SkipThrottle()
@Controller('public/chat-files')
export class PublicChatFilesController {
  constructor(private chats: MetaChatsService) {}

  @Get(':name')
  async file(@Param('name') name: string, @Res() res: Response) {
    const f = await this.chats.publicFile(name).catch(() => {
      throw new NotFoundException();
    });
    if (f.mime) res.type(f.mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(f.path, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}
