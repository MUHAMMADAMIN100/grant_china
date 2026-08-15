import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Личный Telegram-бот сотрудников (12.08.2026). Дублирует в мессенджер то, что
 * уже приходит в колокольчик CRM: назначенная задача, новая консультация,
 * передача студента, напоминания.
 *
 * ОТДЕЛЬНЫЙ ТОКЕН (TELEGRAM_STAFF_BOT_TOKEN), а не общий TELEGRAM_BOT_TOKEN:
 * тот бот публикует программы в канал и обслуживает переписку с клиентами.
 * Один токен на две задачи означал бы, что выключение одной гасит другую, а
 * ошибка в обработчике личных сообщений роняет публикацию каталога.
 *
 * LONG POLLING, а не webhook. Railway держит постоянный процесс, поэтому
 * polling не требует ни публичного URL, ни секрета, ни отдельного маршрута —
 * меньше движущихся частей. Плата за это — при ДВУХ одновременно запущенных
 * копиях приложения Telegram отдаёт 409 Conflict: один из процессов не
 * получит апдейты. Для одного инстанса (текущая конфигурация Railway) это не
 * проблема; при масштабировании надо переходить на webhook.
 *
 * ПРИВЯЗКА. Сотрудник жмёт в CRM «Подключить Telegram» → получает ссылку
 * `t.me/<bot>?start=<код>` → нажимает «Старт» → бот по коду находит запись и
 * записывает chatId. Код одноразовый в том смысле, что при отвязке
 * выпускается новый: иначе старая ссылка, once отправленная в общий чат,
 * навсегда осталась бы годной для перехвата чужих уведомлений.
 */
@Injectable()
export class StaffBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaffBotService.name);
  private bot: Telegraf | null = null;
  private botUsername: string | null = null;

  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const token = config.get<string>('TELEGRAM_STAFF_BOT_TOKEN');
    if (!token) {
      this.logger.warn('Бот уведомлений сотрудникам отключён (нет TELEGRAM_STAFF_BOT_TOKEN)');
      return;
    }
    try {
      this.bot = new Telegraf(token);
    } catch (err) {
      this.logger.error('Не удалось инициализировать бот сотрудников', err as Error);
      this.bot = null;
    }
  }

  isEnabled(): boolean {
    return this.bot !== null;
  }

  async onModuleInit() {
    if (!this.bot) return;

    this.bot.start(async (ctx) => {
      // Telegraf кладёт аргумент /start в ctx.payload (Telegraf 4).
      const code = String((ctx as any).payload || '').trim();
      const chatId = String(ctx.chat.id);
      const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name ?? null);

      if (!code) {
        await ctx.reply(
          'Это бот уведомлений GrantChina.\n\n' +
            'Чтобы получать сюда задачи и консультации, откройте CRM → ваш профиль → ' +
            '«Подключить Telegram» и перейдите по ссылке оттуда.',
        );
        return;
      }

      try {
        const link = await this.prisma.telegramLink.findUnique({
          where: { linkCode: code },
          select: { id: true, userId: true, user: { select: { fullName: true, deletedAt: true } } },
        });
        if (!link || link.user.deletedAt) {
          await ctx.reply('Ссылка недействительна или устарела. Получите новую в CRM.');
          return;
        }
        // Один аккаунт Telegram — один сотрудник. Если этот же chatId уже
        // привязан к КОМУ-ТО ДРУГОМУ, старую привязку снимаем: иначе человек
        // продолжал бы получать чужие уведомления после смены учётки.
        await this.prisma.telegramLink.updateMany({
          where: { chatId, NOT: { id: link.id } },
          data: { chatId: null, username: null, linkedAt: null },
        });
        await this.prisma.telegramLink.update({
          where: { id: link.id },
          data: { chatId, username, linkedAt: new Date() },
        });
        await ctx.reply(
          `Готово, ${link.user.fullName}! ✅\n\n` +
            'Теперь уведомления CRM будут приходить сюда: назначенные задачи, ' +
            'новые консультации и заявки, передача студентов.\n\n' +
            'Отключить можно в CRM, в своём профиле.',
        );
        this.logger.log(`Telegram привязан: ${link.user.fullName} → ${username ?? chatId}`);
      } catch (err) {
        this.logger.error('Ошибка привязки Telegram', err as Error);
        await ctx.reply('Не получилось привязать. Попробуйте ещё раз или обратитесь к руководителю.');
      }
    });

    this.bot.command('stop', async (ctx) => {
      const chatId = String(ctx.chat.id);
      await this.prisma.telegramLink.updateMany({
        where: { chatId },
        data: { chatId: null, username: null, linkedAt: null },
      });
      await ctx.reply('Уведомления отключены. Чтобы включить снова — «Подключить Telegram» в CRM.');
    });

    try {
      const me = await this.bot.telegram.getMe();
      this.botUsername = me.username ?? null;
      // launch() НЕ ждём: в Telegraf 4 его промис завершается только при
      // остановке бота, и await заблокировал бы старт всего приложения.
      void this.bot.launch().catch((err) => {
        this.logger.error('Опрос Telegram остановлен', err as Error);
      });
      this.logger.log(`Бот уведомлений сотрудникам запущен: @${this.botUsername}`);
    } catch (err) {
      this.logger.error('Бот сотрудникам не запустился', err as Error);
      this.bot = null;
    }
  }

  async onModuleDestroy() {
    try {
      this.bot?.stop('SIGTERM');
    } catch {
      /* уже остановлен */
    }
  }

  /**
   * Ссылка для привязки. Код выпускается заново при каждом запросе — старая
   * ссылка, случайно отправленная не туда, перестаёт работать.
   * null — бот выключен (нет токена) либо не удалось узнать его имя.
   */
  async buildLinkUrl(userId: string): Promise<string | null> {
    if (!this.bot || !this.botUsername) return null;
    const code = randomBytes(16).toString('base64url');
    await this.prisma.telegramLink.upsert({
      where: { userId },
      create: { userId, linkCode: code },
      update: { linkCode: code },
    });
    return `https://t.me/${this.botUsername}?start=${code}`;
  }

  /** Состояние привязки для профиля в CRM. */
  async statusFor(userId: string): Promise<{ enabled: boolean; linked: boolean; username: string | null }> {
    if (!this.bot) return { enabled: false, linked: false, username: null };
    const link = await this.prisma.telegramLink.findUnique({
      where: { userId },
      select: { chatId: true, username: true },
    });
    return { enabled: true, linked: !!link?.chatId, username: link?.username ?? null };
  }

  async unlink(userId: string): Promise<void> {
    await this.prisma.telegramLink.updateMany({
      where: { userId },
      data: { chatId: null, username: null, linkedAt: null },
    });
  }

  /**
   * Разослать уведомление привязанным сотрудникам.
   *
   * НИКОГДА не бросает и не тормозит вызывающего: уведомление в мессенджер —
   * приятное дополнение, а не часть операции. Упавший Telegram не имеет права
   * отменить назначение задачи.
   *
   * Список получателей приходит СВЕРХУ, уже посчитанный правами доступа
   * (notifications.service). Здесь он не расширяется ни на кого — иначе
   * разделение офисов, которое так тщательно выстроено в CRM, обошлось бы
   * через мессенджер.
   */
  async pushToUsers(userIds: string[], title: string, message: string): Promise<void> {
    if (!this.bot || userIds.length === 0) return;
    try {
      const links = await this.prisma.telegramLink.findMany({
        where: { userId: { in: userIds }, chatId: { not: null } },
        select: { chatId: true },
      });
      if (!links.length) return;
      const text = `🔔 ${title}\n\n${message}`;
      await Promise.all(
        links.map((l) =>
          this.bot!.telegram.sendMessage(l.chatId!, text).catch((err) => {
            // 403 = сотрудник заблокировал бота. Это его решение, а не сбой:
            // снимаем привязку, чтобы не долбиться в закрытую дверь каждый раз.
            const code = (err as any)?.response?.error_code;
            if (code === 403) {
              return this.prisma.telegramLink
                .updateMany({ where: { chatId: l.chatId }, data: { chatId: null, linkedAt: null } })
                .then(() => undefined);
            }
            this.logger.warn(`Telegram → ${l.chatId}: ${(err as Error).message}`);
            return undefined;
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`Рассылка в Telegram не удалась: ${(err as Error).message}`);
    }
  }
}
