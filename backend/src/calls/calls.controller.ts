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
import { CallsService } from './calls.service';
import { CallWebhookDto, CreateCallDto, UpdateCallDto } from './dto/call.dto';
import { resolveAdapter, type RawWebhookBody } from './call-adapters';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * ТЗ 6.2 — журнал звонков и приём вебхука IP-телефонии.
 *
 * JwtAuthGuard навешен ПОМЕТОДНО, а не на класс: вебхук АТС приходит
 * сервер-к-серверу и никакой cookie сотрудника не приносит. Его авторизация —
 * общий секрет в заголовке (см. webhook ниже), тот же принцип, что у
 * публичной формы заявки: отдельный эндпоинт со своей моделью доверия.
 */
@Controller('calls')
export class CallsController {
  constructor(private calls: CallsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  list(
    @CurrentUser() user: any,
    @Query('studentId') studentId?: string,
    @Query('applicationId') applicationId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.calls.list(
      {
        studentId,
        applicationId,
        userId,
        from: parseDateParam(from),
        to: parseDateParam(to),
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  /**
   * «Кто звонит» по номеру — используется всплывающей карточкой при входящем
   * вызове и формой ручной фиксации звонка. Возвращает однозначное совпадение
   * либо список кандидатов, если номер принадлежит нескольким карточкам.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('resolve')
  resolve(@Query('phone') phone: string) {
    return this.calls.resolveByPhone(phone || '');
  }

  /**
   * Приём события от АТС. Авторизация — общий секрет в заголовке
   * `x-webhook-secret`, сверяется со значением TELEPHONY_WEBHOOK_SECRET.
   *
   * Если секрет не задан в окружении, эндпоинт ОТКЛЮЧЁН (401 на любой запрос).
   * Это осознанно: незаданный секрет означает «интеграция не настроена», и
   * принимать в этом состоянии анонимные записи в журнал звонков нельзя —
   * иначе любой желающий пишет в CRM что угодно (тот же принцип, что у
   * JWT_SECRET, без которого приложение отказывается стартовать).
   *
   * Лимит 300/мин: всплеск звонков на большом отделе реален, но не безграничен.
   */
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Post('webhook/:provider')
  async webhook(
    @Param('provider') provider: string,
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: RawWebhookBody,
  ) {
    const expected = process.env.TELEPHONY_WEBHOOK_SECRET;
    if (!expected || !secret || secret !== expected) {
      throw new UnauthorizedException('Неверный секрет вебхука');
    }

    const adapter = resolveAdapter(provider);
    if (!adapter) {
      throw new UnauthorizedException(`Неизвестный провайдер телефонии: ${provider}`);
    }

    const normalized = adapter(body);
    // Адаптер вернул null — это промежуточное событие (начало звонка, звонок
    // между сотрудниками), которое в историю не пишется. Отвечаем 200, иначе
    // АТС посчитает доставку неудачной и будет ретраить её до бесконечности.
    if (!normalized) return { ok: true, ignored: true };

    return this.calls.ingestWebhook(provider.toLowerCase(), normalized as CallWebhookDto);
  }

  /** ТЗ 6.2 — ручная фиксация разговора (работает и без подключённой АТС). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  create(@Body() dto: CreateCallDto, @CurrentUser() user: any) {
    return this.calls.create(dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCallDto, @CurrentUser() user: any) {
    return this.calls.update(id, dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.calls.findOne(id, user);
  }
}
