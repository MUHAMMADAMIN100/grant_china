import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageDirection, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { normalizePhone } from '../common/phone';
import { canSendTo } from './channels';
import { TelegramClientBotService } from './telegram-client.service';
import { AssignConversationDto, LinkConversationDto, SendMessageDto } from './dto/messaging.dto';

export type CurrentUser = { id: string; role: Role };

const CONVERSATION_INCLUDE = {
  student: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  application: { select: { id: true, fullName: true, status: true, managerId: true, chinaManagerId: true } },
  assignedTo: { select: { id: true, fullName: true } },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

/** Превью последнего сообщения в списке диалогов — полный текст живёт в ленте. */
const PREVIEW_LEN = 160;
const preview = (text: string): string => (text.length > PREVIEW_LEN ? `${text.slice(0, PREVIEW_LEN)}…` : text);

/**
 * ТЗ 6.4 — единое окно агрегации сообщений из мессенджеров с автоматической
 * привязкой диалогов к карточкам клиентов.
 *
 * ВИДИМОСТЬ. Диалог, ПРИВЯЗАННЫЙ к карточке, наследует её правила доступа
 * (canAccessStudentRecord — тот же приём, что у заявок, грантов и договоров).
 * Диалог БЕЗ привязки виден всем сотрудникам: это входящее обращение с улицы,
 * его должен подхватить кто угодно — ровно так же, как «свободную» заявку.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private notifications: NotificationsService,
    private realtime: RealtimeGateway,
    private telegram: TelegramClientBotService,
  ) {}

  // ------------------------------------------------------------------
  // Доступ
  // ------------------------------------------------------------------

  /**
   * Условие видимости для списка. Непривилегированный сотрудник видит:
   *  - диалоги без привязки (обращение с улицы — «свободное»);
   *  - диалоги своих студентов/заявок;
   *  - закреплённые лично за ним.
   */
  private scopeWhere(user: CurrentUser): Prisma.ConversationWhereInput {
    if (isPrivileged(user.role)) return {};
    return {
      OR: [
        { studentId: null, applicationId: null },
        { assignedToId: user.id },
        { student: { OR: [{ managerId: user.id }, { chinaManagerId: user.id }] } },
        { application: { OR: [{ managerId: user.id }, { chinaManagerId: user.id }] } },
      ],
    };
  }

  private canAccess(c: ConversationRow, user: CurrentUser): boolean {
    if (isPrivileged(user.role)) return true;
    if (c.assignedToId === user.id) return true;
    if (!c.studentId && !c.applicationId) return true;
    if (c.student && canAccessStudentRecord(c.student, user)) return true;
    if (c.application && canAccessStudentRecord(c.application, user)) return true;
    return false;
  }

  private async loadForMutation(id: string, user: CurrentUser): Promise<ConversationRow> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, deletedAt: null },
      include: CONVERSATION_INCLUDE,
    });
    // 404, а не 403 — не быть оракулом существования id (правило проекта).
    if (!conversation || !this.canAccess(conversation, user)) throw new NotFoundException('Диалог не найден');
    return conversation;
  }

  // ------------------------------------------------------------------
  // Чтение
  // ------------------------------------------------------------------

  async listConversations(
    filters: { mine?: boolean; unread?: boolean; channel?: string; search?: string; page?: number; pageSize?: number },
    user: CurrentUser,
  ) {
    const and: Prisma.ConversationWhereInput[] = [this.scopeWhere(user)];
    if (filters.mine) and.push({ assignedToId: user.id });
    if (filters.unread) and.push({ unreadCount: { gt: 0 } });
    if (filters.channel) and.push({ channel: filters.channel });
    if (filters.search) {
      and.push({
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { username: { contains: filters.search, mode: 'insensitive' } },
          { phone: { contains: filters.search, mode: 'insensitive' } },
          { student: { fullName: { contains: filters.search, mode: 'insensitive' } } },
        ],
      });
    }

    const where: Prisma.ConversationWhereInput = { deletedAt: null, AND: and };
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 30));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: pageSize,
        include: CONVERSATION_INCLUDE,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Счётчик для бейджа в меню — считает ровно то, что сотрудник увидит в списке. */
  async unreadCount(user: CurrentUser) {
    const count = await this.prisma.conversation.count({
      where: { deletedAt: null, unreadCount: { gt: 0 }, AND: [this.scopeWhere(user)] },
    });
    return { count };
  }

  async findOne(id: string, user: CurrentUser) {
    return this.loadForMutation(id, user);
  }

  async messages(id: string, user: CurrentUser, filters: { page?: number; pageSize?: number }) {
    await this.loadForMutation(id, user);
    const where: Prisma.ChannelMessageWhereInput = { conversationId: id, deletedAt: null };
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 100));
    const skip = (page - 1) * pageSize;
    // Страница 1 — САМЫЕ СВЕЖИЕ сообщения, страница 2 — предыдущие и так
    // вглубь истории. С сортировкой asc первая страница отдавала бы начало
    // переписки, и в диалоге длиннее pageSize менеджер не увидел бы последнее
    // сообщение клиента вообще — то есть именно то, ради чего открыл диалог.
    //
    // Наружу при этом всегда уходит ХРОНОЛОГИЧЕСКИЙ порядок: разворачиваем
    // здесь, чтобы каждый клиент не изобретал этот разворот заново.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.channelMessage.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip,
        take: pageSize,
        include: { author: { select: { id: true, fullName: true } } },
      }),
      this.prisma.channelMessage.count({ where }),
    ]);
    return { items: items.reverse(), total, page, pageSize };
  }

  // ------------------------------------------------------------------
  // Действия сотрудника
  // ------------------------------------------------------------------

  async markRead(id: string, user: CurrentUser) {
    await this.loadForMutation(id, user);
    await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    return { ok: true };
  }

  async assign(id: string, dto: AssignConversationDto, user: CurrentUser) {
    const conversation = await this.loadForMutation(id, user);
    let assignedToId: string | null = null;
    if (dto.assignedToId) {
      const target = await this.prisma.user.findFirst({
        where: { id: dto.assignedToId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('Сотрудник не найден');
      assignedToId = target.id;
    }
    await this.prisma.conversation.update({ where: { id }, data: { assignedToId } });
    this.realtime.emitAllStaff('conversation:updated', { id: conversation.id });
    return this.prisma.conversation.findUniqueOrThrow({ where: { id }, include: CONVERSATION_INCLUDE });
  }

  /** Ручная привязка диалога к карточке (ТЗ 6.4 — «привязка диалогов к карточкам клиентов»). */
  async link(id: string, dto: LinkConversationDto, user: CurrentUser) {
    const conversation = await this.loadForMutation(id, user);

    let studentId: string | null = conversation.studentId;
    let applicationId: string | null = conversation.applicationId;
    let label = '';

    if (dto.studentId !== undefined) {
      if (dto.studentId) {
        const student = await this.prisma.student.findFirst({
          where: { id: dto.studentId, deletedAt: null },
          select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
        });
        // IDOR: привязать можно только к доступной карточке — иначе сотрудник
        // получил бы доступ к чужому клиенту, просто привязав к нему диалог.
        if (!student || !canAccessStudentRecord(student, user)) throw new NotFoundException('Студент не найден');
        studentId = student.id;
        label = student.fullName;
      } else {
        studentId = null;
      }
    }

    if (dto.applicationId !== undefined) {
      if (dto.applicationId) {
        const app = await this.prisma.application.findFirst({
          where: { id: dto.applicationId, deletedAt: null },
          select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
        });
        if (!app || !canAccessStudentRecord(app, user)) throw new NotFoundException('Заявка не найдена');
        applicationId = app.id;
        label = label || app.fullName;
      } else {
        applicationId = null;
      }
    }

    await this.prisma.conversation.update({ where: { id }, data: { studentId, applicationId } });

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONVERSATION_LINK',
        studentId,
        studentName: label || null,
        details: studentId || applicationId ? `Диалог привязан к карточке: ${label || '—'}` : 'Диалог отвязан от карточки',
      })
      .catch(() => undefined);
    this.realtime.emitAllStaff('conversation:updated', { id });

    return this.prisma.conversation.findUniqueOrThrow({ where: { id }, include: CONVERSATION_INCLUDE });
  }

  /** ТЗ 6.4 — ответ клиенту прямо из CRM. */
  async send(id: string, dto: SendMessageDto, user: CurrentUser) {
    const conversation = await this.loadForMutation(id, user);
    if (!canSendTo(conversation.channel)) {
      throw new BadRequestException(
        `Отправка в канал «${conversation.channel}» пока не подключена — ответьте клиенту в самом мессенджере.`,
      );
    }

    const text = dto.text.trim();
    const externalId = await this.telegram.sendMessage(conversation.externalId, text);
    if (!externalId) {
      // Провайдер не принял сообщение — НЕ пишем его в ленту. Иначе менеджер
      // увидел бы свой ответ в CRM и был бы уверен, что клиент его получил.
      throw new BadRequestException('Не удалось отправить сообщение. Проверьте настройки бота и попробуйте ещё раз.');
    }

    const now = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.channelMessage.create({
        data: {
          conversationId: id,
          direction: MessageDirection.OUTBOUND,
          text,
          externalId,
          authorId: user.id,
          sentAt: now,
        },
        include: { author: { select: { id: true, fullName: true } } },
      }),
      this.prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: now, lastMessageText: preview(text), unreadCount: 0 },
      }),
    ]);

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'MESSAGE_SENT',
        studentId: conversation.studentId,
        studentName: conversation.student?.fullName ?? conversation.title ?? null,
        details: `Ответ клиенту в ${conversation.channel}: ${preview(text)}`,
      })
      .catch(() => undefined);
    this.realtime.emitAllStaff('conversation:updated', { id });

    return message;
  }

  // ------------------------------------------------------------------
  // Приём входящих (вебхук провайдера)
  // ------------------------------------------------------------------

  /**
   * Записывает входящее сообщение. Системный путь: личности пользователя нет,
   * авторизация — секрет вебхука, проверенный контроллером (как у джоб
   * планировщика и вебхука телефонии).
   *
   * ИДЕМПОТЕНТНОСТЬ: @@unique([conversationId, externalId]) в схеме. Telegram
   * (как и любой провайдер) повторяет доставку при сетевой ошибке — второй
   * INSERT падает с P2002, мы его молча глотаем (паттерн A из job.contract.ts).
   */
  async ingestInbound(input: {
    channel: string;
    externalChatId: string;
    externalMessageId: string;
    text: string | null;
    attachments?: unknown;
    title?: string | null;
    username?: string | null;
    phone?: string | null;
    sentAt: Date;
  }) {
    const phoneNormalized = input.phone ? normalizePhone(input.phone) : null;

    // Диалог: создаём при первом сообщении, дальше только обновляем «шапку».
    const conversation = await this.prisma.conversation.upsert({
      where: { channel_externalId: { channel: input.channel, externalId: input.externalChatId } },
      create: {
        channel: input.channel,
        externalId: input.externalChatId,
        title: input.title ?? null,
        username: input.username ?? null,
        phone: input.phone ?? null,
        phoneNormalized,
        lastMessageAt: input.sentAt,
        lastMessageText: input.text ? preview(input.text) : '[вложение]',
        unreadCount: 1,
      },
      update: {
        // Имя/ник могли смениться у клиента — подтягиваем, но не затираем
        // ранее известный телефон пустым значением.
        ...(input.title ? { title: input.title } : {}),
        ...(input.username ? { username: input.username } : {}),
        ...(input.phone ? { phone: input.phone, phoneNormalized } : {}),
        lastMessageAt: input.sentAt,
        lastMessageText: input.text ? preview(input.text) : '[вложение]',
        unreadCount: { increment: 1 },
      },
      include: CONVERSATION_INCLUDE,
    });

    try {
      await this.prisma.channelMessage.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.INBOUND,
          text: input.text,
          attachments: (input.attachments ?? undefined) as Prisma.InputJsonValue | undefined,
          externalId: input.externalMessageId,
          sentAt: input.sentAt,
        },
      });
    } catch (e) {
      // P2002 = повторная доставка того же сообщения. Это ожидаемо и не ошибка.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: true, duplicate: true, conversationId: conversation.id };
      }
      throw e;
    }

    // Автопривязка к карточке — только если диалог ещё ни к кому не привязан
    // и только при ОДНОЗНАЧНОМ совпадении по номеру (один номер в Таджикистане
    // часто принадлежит семье; при нескольких совпадениях менеджер выбирает сам).
    if (!conversation.studentId && !conversation.applicationId && phoneNormalized) {
      await this.tryAutoLink(conversation.id, phoneNormalized);
    }

    // Уведомляем ответственного, а если его нет — руководство. Без этого
    // сообщение клиента лежало бы в CRM, пока кто-нибудь не откроет раздел.
    if (conversation.assignedToId) {
      this.notifications
        .notifyUser(conversation.assignedToId, {
          type: 'MESSAGE_INBOUND',
          title: 'Новое сообщение от клиента',
          message: `${conversation.title ?? conversation.username ?? 'Клиент'}: ${input.text ? preview(input.text) : '[вложение]'}`,
          payload: { conversationId: conversation.id, studentId: conversation.studentId },
        })
        .catch(() => undefined);
    }

    this.realtime.emitAllStaff('conversation:updated', { id: conversation.id });

    return { ok: true, duplicate: false, conversationId: conversation.id };
  }

  /** Однозначное совпадение по номеру — иначе связь не ставим вовсе. */
  private async tryAutoLink(conversationId: string, phoneNormalized: string): Promise<void> {
    const applications = await this.prisma.application.findMany({
      where: { deletedAt: null, phoneNormalized },
      orderBy: { createdAt: 'desc' },
      select: { id: true, studentId: true },
      take: 3,
    });
    if (applications.length !== 1) return;

    const [app] = applications;
    await this.prisma.conversation
      .update({
        where: { id: conversationId },
        data: { applicationId: app.id, studentId: app.studentId },
      })
      .catch((e) => {
        this.logger.warn(`Автопривязка диалога ${conversationId} не выполнена: ${e?.message ?? e}`);
      });
  }
}
