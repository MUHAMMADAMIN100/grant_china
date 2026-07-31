import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MessagingService } from './messaging.service';
import { TelegramClientBotService } from './telegram-client.service';
import { AssignConversationDto, LinkConversationDto, SendMessageDto } from './dto/messaging.dto';
import { CHANNELS } from './channels';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

/** Минимальная форма апдейта Telegram, которая нас интересует. */
interface TelegramUpdate {
  message?: {
    message_id: number;
    date: number;
    text?: string;
    caption?: string;
    chat: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      title?: string;
    };
    from?: { first_name?: string; last_name?: string; username?: string };
    contact?: { phone_number?: string };
    photo?: Array<{ file_id: string }>;
    document?: { file_id: string; file_name?: string; mime_type?: string };
    voice?: { file_id: string };
    video?: { file_id: string };
  };
}

/**
 * ТЗ 6.4 — единое окно диалогов.
 *
 * JwtAuthGuard навешен ПОМЕТОДНО: вебхук Telegram приходит сервер-к-серверу и
 * cookie сотрудника не приносит. Его авторизация — секретный заголовок
 * `X-Telegram-Bot-Api-Secret-Token`, который Telegram отправляет ровно то
 * значение, что мы передали в setWebhook (см. telegram-client.service.ts).
 * Тот же принцип разделения моделей доверия, что у публичной формы заявки и
 * вебхука телефонии.
 */
@Controller('messaging')
export class MessagingController {
  constructor(
    private messaging: MessagingService,
    private telegram: TelegramClientBotService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('channels')
  channels() {
    return { items: CHANNELS, telegramEnabled: this.telegram.isEnabled() };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('conversations')
  list(
    @CurrentUser() user: any,
    @Query('mine') mine?: string,
    @Query('unread') unread?: string,
    @Query('channel') channel?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.messaging.listConversations(
      {
        mine: mine === 'true',
        unread: unread === 'true',
        channel: channel || undefined,
        search: search || undefined,
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('conversations/unread-count')
  unreadCount(@CurrentUser() user: any) {
    return this.messaging.unreadCount(user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('conversations/:id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.messaging.findOne(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('conversations/:id/messages')
  messages(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.messaging.messages(id, user, { page: parsePage(page), pageSize: parsePageSize(pageSize) });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('conversations/:id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.messaging.markRead(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('conversations/:id/messages')
  send(@Param('id') id: string, @Body() dto: SendMessageDto, @CurrentUser() user: any) {
    return this.messaging.send(id, dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch('conversations/:id/link')
  link(@Param('id') id: string, @Body() dto: LinkConversationDto, @CurrentUser() user: any) {
    return this.messaging.link(id, dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch('conversations/:id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignConversationDto, @CurrentUser() user: any) {
    return this.messaging.assign(id, dto, user);
  }

  /**
   * Вебхук клиентского Telegram-бота. Секрет сверяется с тем, что мы сами
   * передали Telegram в setWebhook — подделать его может только тот, кто уже
   * знает значение из переменных окружения.
   *
   * Лимит 600/мин: всплеск сообщений в рабочее время реален, но не безграничен.
   */
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post('webhook/telegram')
  async telegramWebhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    if (!this.telegram.verifySecret(secret)) {
      throw new UnauthorizedException('Неверный секрет вебхука');
    }

    const msg = update?.message;
    // Не сообщение (правка, сервисное событие) — отвечаем 200, иначе Telegram
    // будет ретраить доставку до бесконечности.
    if (!msg?.chat?.id) return { ok: true, ignored: true };

    const from = msg.from ?? {};
    const title =
      [from.first_name, from.last_name].filter(Boolean).join(' ') ||
      msg.chat.title ||
      [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') ||
      null;

    // Вложения: сохраняем ССЫЛКИ у Telegram, файлы в /uploads не тянем —
    // клиент может прислать что угодно и сколько угодно, и хранение этого
    // потока решается отдельно (та же логика, что у записей разговоров).
    const attachments: Array<{ type: string; fileId: string; name?: string }> = [];
    if (msg.photo?.length) attachments.push({ type: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id });
    if (msg.document) attachments.push({ type: 'document', fileId: msg.document.file_id, name: msg.document.file_name });
    if (msg.voice) attachments.push({ type: 'voice', fileId: msg.voice.file_id });
    if (msg.video) attachments.push({ type: 'video', fileId: msg.video.file_id });

    return this.messaging.ingestInbound({
      channel: 'TELEGRAM',
      externalChatId: String(msg.chat.id),
      externalMessageId: String(msg.message_id),
      text: msg.text ?? msg.caption ?? null,
      attachments: attachments.length ? attachments : undefined,
      title,
      username: msg.chat.username ?? from.username ?? null,
      // Телефон приходит, только если клиент явно поделился контактом —
      // именно по нему работает автопривязка к карточке.
      phone: msg.contact?.phone_number ?? null,
      sentAt: new Date(msg.date * 1000),
    });
  }
}
