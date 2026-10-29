import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Direction, MessageDirection, Prisma, Region, Role } from '@prisma/client';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ActivityService } from '../../activity/activity.service';
import { isPrivileged } from '../../common/roles';
import { normalizePhone } from '../../common/phone';
import { findRepeatOfId } from '../../common/application-repeat';
import { claimFirstTouch } from '../../common/lead-touch';
import {
  configFor,
  instagramConfig,
  isMetaChannel,
  OUTGOING_LIMITS,
  publicApiUrl,
  REPLY_WINDOW_MS,
  TEXT_LIMIT_BYTES,
  whatsappConfig,
  type MetaChannel,
} from './meta.config';
import { classifyMetaError, MetaApiError, type MetaFailure } from './meta.http';
import { InstagramApi, MetaTokensService, WhatsAppApi } from './meta.api';
import { MetaMediaService, sniff } from './meta.media';
import type { ChatEvent, IncomingAttachment } from './meta.parsers';

type CurrentUser = { id: string; role: Role; region?: Region };

const PREVIEW_LEN = 160;
const preview = (text: string) => (text.length > PREVIEW_LEN ? `${text.slice(0, PREVIEW_LEN)}…` : text);
const KIND_PREVIEW: Record<string, string> = {
  IMAGE: '[фото]',
  VIDEO: '[видео]',
  AUDIO: '[голосовое]',
  FILE: '[файл]',
  STICKER: '[стикер]',
  SHARE: '[пост]',
  REEL: '[reels]',
  STORY: '[история]',
  LOCATION: '[место]',
  CONTACT: '[контакт]',
  UNSUPPORTED: '[сообщение]',
};
const previewOf = (text: string | null | undefined, kinds: string[]) =>
  text ? preview(text) : kinds.length ? KIND_PREVIEW[kinds[0]] ?? '[вложение]' : '[сообщение]';

const STATUS_RANK: Record<string, number> = { SENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** Человеческие фразы для причин отказа — их же показывает CRM. */
export const FAILURE_TEXT: Record<MetaFailure, string> = {
  TOKEN_INVALID: 'Ключ доступа Meta больше не действует — сообщите руководителю.',
  WINDOW_CLOSED: 'Прошло больше 24 часов с последнего сообщения клиента — Meta не разрешает писать первым.',
  UNAVAILABLE: 'Этому человеку нельзя написать: он ограничил сообщения или удалил аккаунт.',
  TEST_RECIPIENT: 'Тестовый номер Meta пишет только номерам из списка получателей.',
  NETWORK: 'Meta не ответила — повторите отправку через минуту.',
  REJECTED: 'Meta отклонила сообщение.',
};

/** Деление длинного текста по байтам UTF-8, на ближайшем к границе пробеле или переводе строки. */
export function splitByBytes(text: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (Buffer.byteLength(rest, 'utf8') > limit) {
    let cut = 0;
    let bytes = 0;
    for (const ch of rest) {
      const b = Buffer.byteLength(ch, 'utf8');
      if (bytes + b > limit) break;
      bytes += b;
      cut += ch.length;
    }
    const head = rest.slice(0, cut);
    const soft = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
    const at = soft > cut * 0.5 ? soft : cut;
    const piece = rest.slice(0, at).trimEnd();
    if (piece) parts.push(piece);
    rest = rest.slice(at).trimStart();
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

/** Instagram мест не умеет: ему уходит текст с названием, адресом и ссылкой на карту. */
export function locationText(lat: number, lon: number, name?: string | null, address?: string | null): string {
  const head = [name, address].filter(Boolean).join(', ');
  const link = `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=17/${lat.toFixed(6)}/${lon.toFixed(6)}`;
  return `📍 ${head ? `${head}\n` : ''}${link}`;
}

const CONV_SELECT = {
  id: true,
  channel: true,
  externalId: true,
  title: true,
  username: true,
  phone: true,
  studentId: true,
  applicationId: true,
  assignedToId: true,
  lastIncomingAt: true,
  assignedTo: { select: { id: true, fullName: true, region: true, deletedAt: true } },
} satisfies Prisma.ConversationSelect;
type ConvRow = Prisma.ConversationGetPayload<{ select: typeof CONV_SELECT }>;

export const MESSAGE_INCLUDE = {
  author: { select: { id: true, fullName: true } },
  chatAttachments: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      kind: true,
      mimeType: true,
      size: true,
      name: true,
      url: true,
      latitude: true,
      longitude: true,
      address: true,
      downloadState: true,
      storedName: true,
    },
  },
} satisfies Prisma.ChannelMessageInclude;

/**
 * 29.10.2026 — Instagram Direct и WhatsApp через приложения Meta.
 *
 * Правила владельца для этих двух каналов:
 *  - все сотрудники видят все чаты (MessagingService.scopeWhere);
 *  - свободный чат берёт тот, кто ответил первым или нажал «Взять себе»;
 *  - отвечать в занятом чате могут ответственный и руководство;
 *  - новый чат — уведомление всем; сообщение в занятом чате — ответственному;
 *  - заявка создаётся кнопкой из чата, направление выбирает менеджер.
 *
 * Сначала запись, потом отправка: сообщение сотрудника сразу лежит в базе со
 * статусом SENDING и не теряется, даже если Meta не ответила.
 */
@Injectable()
export class MetaChatsService {
  private readonly logger = new Logger(MetaChatsService.name);
  private statusCache = new Map<MetaChannel, { until: number; account: string | null }>();

  constructor(
    private prisma: PrismaService,
    private ig: InstagramApi,
    private wa: WhatsAppApi,
    private tokens: MetaTokensService,
    private media: MetaMediaService,
    private notifications: NotificationsService,
    private realtime: RealtimeGateway,
    private activity: ActivityService,
  ) {}

  // =================================================================== приём

  /**
   * Записывает события в базу и только потом отдаёт управление контроллеру —
   * 200 Meta получает ПОСЛЕ записи: при сбое она повторит уведомление, а
   * повтор отсекается по externalId. Файлы и фото профиля качаются в фоне.
   */
  async receive(channel: MetaChannel, events: ChatEvent[]): Promise<{ processed: number; foreign: number }> {
    const cfg = configFor(channel);
    const background: Array<() => Promise<void>> = [];
    let processed = 0;
    let foreign = 0;
    for (const ev of events) {
      if (ev.accountId !== cfg.accountId) {
        // Чужой аккаунт (в т.ч. id «0» от кнопки «Тестировать») — пропускаем без текста в журнале.
        foreign++;
        continue;
      }
      switch (ev.type) {
        case 'message':
          if (ev.echo) await this.handleEcho(channel, ev, background);
          else await this.handleIncoming(channel, ev, background);
          break;
        case 'status':
          await this.handleStatus(ev);
          break;
        case 'reaction':
          await this.handleReaction(channel, ev);
          break;
        case 'read':
          await this.handleRead(channel, ev);
          break;
        case 'deleted':
          await this.handleDeleted(channel, ev);
          break;
      }
      processed++;
    }
    if (foreign) this.logger.warn(`${channel}: пропущено событий чужого аккаунта: ${foreign}`);
    if (background.length) {
      setImmediate(() => {
        void (async () => {
          for (const task of background) await task().catch((e) => this.logger.warn(`Фоновая задача ${channel}: ${(e as Error).message}`));
        })();
      });
    }
    return { processed, foreign };
  }

  private async findMessage(channel: MetaChannel, externalId: string) {
    return this.prisma.channelMessage.findFirst({
      where: { externalId, conversation: { channel } },
      select: { id: true, conversationId: true, status: true, direction: true },
    });
  }

  private async handleIncoming(channel: MetaChannel, ev: Extract<ChatEvent, { type: 'message' }>, background: Array<() => Promise<void>>) {
    if (await this.findMessage(channel, ev.externalId)) return; // повтор уведомления
    const phone = channel === 'WHATSAPP' ? ev.contactPhone ?? ev.contactId : null;
    const phoneNormalized = phone ? normalizePhone(phone) : null;
    const kinds = ev.attachments.map((a) => a.kind);
    const text = previewOf(ev.text, kinds);

    let result: { convId: string; created: boolean; messageId: string; attachmentIds: string[] } | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await this.prisma.$transaction(async (tx) => {
          const before = await tx.conversation.findUnique({
            where: { channel_externalId: { channel, externalId: ev.contactId } },
            select: { id: true },
          });
          const conv = before
            ? before
            : await tx.conversation.create({
                data: {
                  channel,
                  externalId: ev.contactId,
                  accountId: ev.accountId,
                  title: ev.contactName ?? null,
                  phone,
                  phoneNormalized,
                  lastMessageAt: ev.sentAt,
                  lastIncomingAt: ev.sentAt,
                  lastMessageText: text,
                  unreadCount: 1,
                },
                select: { id: true },
              });
          const msg = await tx.channelMessage.create({
            data: {
              conversationId: conv.id,
              direction: MessageDirection.INBOUND,
              text: ev.text,
              externalId: ev.externalId,
              sentAt: ev.sentAt,
              replyToExternalId: ev.replyToExternalId ?? null,
              chatAttachments: { create: ev.attachments.map((a) => this.attachmentData(a)) },
            },
            select: { id: true, chatAttachments: { select: { id: true } } },
          });
          if (before) {
            // Сообщения приходят не по порядку: время двигаем только вперёд.
            await tx.$executeRaw`
              UPDATE "Conversation" SET
                "unreadCount" = "unreadCount" + 1,
                "lastMessageText" = CASE WHEN ${ev.sentAt} >= "lastMessageAt" THEN ${text} ELSE "lastMessageText" END,
                "lastMessageAt" = GREATEST("lastMessageAt", ${ev.sentAt}),
                "lastIncomingAt" = GREATEST(COALESCE("lastIncomingAt", ${ev.sentAt}), ${ev.sentAt}),
                "accountId" = COALESCE("accountId", ${ev.accountId}),
                "title" = COALESCE(${ev.contactName ?? null}::text, "title"),
                "updatedAt" = NOW()
              WHERE "id" = ${conv.id}`;
          }
          return { convId: conv.id, created: !before, messageId: msg.id, attachmentIds: msg.chatAttachments.map((a) => a.id) };
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const target = String(Array.isArray(e.meta?.target) ? (e.meta?.target as string[]).join(',') : e.meta?.target ?? '');
          if (target.includes('conversationId')) return; // дубль сообщения (уникальность ChannelMessage)
          continue; // два первых сообщения одновременно: повторяем, теперь беседа уже есть
        }
        throw e;
      }
    }
    if (!result) throw new Error('Не удалось записать сообщение после повтора');

    const conv = await this.prisma.conversation.findUniqueOrThrow({ where: { id: result.convId }, select: CONV_SELECT });
    if (result.created && phoneNormalized && !conv.studentId && !conv.applicationId) await this.tryAutoLink(conv.id, phoneNormalized);

    // Уведомления: новый чат — всем; сообщение в занятом — ответственному.
    const who = conv.title ?? conv.username ?? conv.phone ?? 'Клиент';
    const label = channel === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp';
    if (conv.assignedToId) {
      this.notifications
        .notifyUser(conv.assignedToId, {
          type: 'MESSAGE_INBOUND',
          title: `Новое сообщение в ${label}`,
          message: `${who}: ${text}`,
          payload: { conversationId: conv.id },
        })
        .catch(() => undefined);
    } else if (result.created) {
      void this.notifyAllStaff({ type: 'MESSAGE_INBOUND', title: `Новый чат в ${label}`, message: `${who}: ${text}`, payload: { conversationId: conv.id } });
    }
    this.emit(conv.id, { inbound: true, assignedToId: conv.assignedToId });

    for (const attId of result.attachmentIds) background.push(() => this.downloadAttachment(channel, attId, conv.id));
    if (channel === 'INSTAGRAM') {
      const fresh = await this.prisma.conversation.findUnique({ where: { id: conv.id }, select: { profileCheckedAt: true } });
      const stale = !fresh?.profileCheckedAt || Date.now() - fresh.profileCheckedAt.getTime() > 7 * 86400_000;
      if (stale) background.push(() => this.refreshInstagramProfile(conv.id, ev.contactId));
    }
  }

  /**
   * Эхо Instagram — наше же сообщение. Ищем своё недавнее (2 минуты) с тем же
   * текстом без externalId и присваиваем ему id. Не нашли — значит, написали
   * прямо в приложении Instagram: сохраняем как исходящее без автора.
   */
  private async handleEcho(channel: MetaChannel, ev: Extract<ChatEvent, { type: 'message' }>, background: Array<() => Promise<void>>) {
    if (await this.findMessage(channel, ev.externalId)) return;
    let conv = await this.prisma.conversation.findUnique({
      where: { channel_externalId: { channel, externalId: ev.contactId } },
      select: { id: true },
    });
    if (!conv) {
      conv = await this.prisma.conversation
        .create({ data: { channel, externalId: ev.contactId, accountId: ev.accountId, lastMessageAt: ev.sentAt, unreadCount: 0 }, select: { id: true } })
        .catch(async () => this.prisma.conversation.findUniqueOrThrow({ where: { channel_externalId: { channel, externalId: ev.contactId } }, select: { id: true } }));
      background.push(() => this.refreshInstagramProfile(conv!.id, ev.contactId));
    }
    const candidate = await this.prisma.channelMessage.findFirst({
      where: {
        conversationId: conv.id,
        direction: MessageDirection.OUTBOUND,
        externalId: null,
        createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
        text: ev.text ?? null,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true },
    });
    if (candidate) {
      await this.prisma.channelMessage
        .update({
          where: { id: candidate.id },
          data: { externalId: ev.externalId, status: candidate.status === 'SENDING' || candidate.status === 'FAILED' ? 'SENT' : candidate.status, error: null, errorDetail: null },
        })
        .catch(() => undefined);
      this.emit(conv.id, {});
      return;
    }
    const kinds = ev.attachments.map((a) => a.kind);
    try {
      const msg = await this.prisma.channelMessage.create({
        data: {
          conversationId: conv.id,
          direction: MessageDirection.OUTBOUND,
          text: ev.text,
          externalId: ev.externalId,
          sentAt: ev.sentAt,
          status: 'SENT',
          chatAttachments: { create: ev.attachments.map((a) => this.attachmentData(a)) },
        },
        select: { chatAttachments: { select: { id: true } } },
      });
      await this.prisma.$executeRaw`
        UPDATE "Conversation" SET
          "lastMessageText" = CASE WHEN ${ev.sentAt} >= "lastMessageAt" THEN ${previewOf(ev.text, kinds)} ELSE "lastMessageText" END,
          "lastMessageAt" = GREATEST("lastMessageAt", ${ev.sentAt}),
          "updatedAt" = NOW()
        WHERE "id" = ${conv.id}`;
      for (const a of msg.chatAttachments) background.push(() => this.downloadAttachment(channel, a.id, conv!.id));
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    this.emit(conv.id, {});
  }

  /** Статус WhatsApp никогда не идёт назад: опоздавший «доставлено» не перетирает «прочитано». */
  private async handleStatus(ev: Extract<ChatEvent, { type: 'status' }>) {
    const msg = await this.findMessage('WHATSAPP', ev.externalId);
    if (!msg || msg.direction !== MessageDirection.OUTBOUND) return;
    const cur = msg.status ?? 'SENT';
    if (ev.status === 'FAILED') {
      if (cur === 'DELIVERED' || cur === 'READ') return;
      const reason = ev.errorCode != null ? classifyMetaError('WHATSAPP', ev.errorCode, null) : 'REJECTED';
      await this.prisma.channelMessage.update({ where: { id: msg.id }, data: { status: 'FAILED', error: reason, errorDetail: ev.errorCode != null ? String(ev.errorCode) : null } });
    } else {
      if (cur !== 'FAILED' && (STATUS_RANK[ev.status] ?? 0) <= (STATUS_RANK[cur] ?? 0)) return;
      await this.prisma.channelMessage.update({ where: { id: msg.id }, data: { status: ev.status, error: null, errorDetail: null } });
    }
    this.emit(msg.conversationId, {});
  }

  private async handleReaction(channel: MetaChannel, ev: Extract<ChatEvent, { type: 'reaction' }>) {
    const msg = await this.findMessage(channel, ev.externalId);
    if (!msg) return;
    await this.prisma.channelMessage.update({ where: { id: msg.id }, data: { contactReaction: ev.emoji } });
    this.emit(msg.conversationId, {});
  }

  /** Instagram «прочитано»: всё наше отправленное до этого момента — прочитано. */
  private async handleRead(channel: MetaChannel, ev: Extract<ChatEvent, { type: 'read' }>) {
    const conv = await this.prisma.conversation.findUnique({ where: { channel_externalId: { channel, externalId: ev.contactId } }, select: { id: true } });
    if (!conv) return;
    const res = await this.prisma.channelMessage.updateMany({
      where: { conversationId: conv.id, direction: MessageDirection.OUTBOUND, status: { in: ['SENT', 'DELIVERED'] }, sentAt: { lte: ev.at } },
      data: { status: 'READ' },
    });
    if (res.count) this.emit(conv.id, {});
  }

  private async handleDeleted(channel: MetaChannel, ev: Extract<ChatEvent, { type: 'deleted' }>) {
    const msg = await this.findMessage(channel, ev.externalId);
    if (!msg) return;
    await this.prisma.channelMessage.update({ where: { id: msg.id }, data: { deletedByContactAt: new Date() } });
    this.emit(msg.conversationId, {});
  }

  private attachmentData(a: IncomingAttachment): Prisma.ChatAttachmentCreateWithoutMessageInput {
    const downloadable =
      ['IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'STICKER'].includes(a.kind) ||
      (['REEL', 'STORY', 'SHARE'].includes(a.kind) && !!a.url && /(fbcdn\.net|cdninstagram\.com|fbsbx\.com)/.test(a.url));
    return {
      kind: a.kind,
      url: a.url ?? null,
      mediaId: a.mediaId ?? null,
      mimeType: a.mimeType ?? null,
      name: a.name ?? null,
      latitude: Number.isFinite(a.latitude as number) ? (a.latitude as number) : null,
      longitude: Number.isFinite(a.longitude as number) ? (a.longitude as number) : null,
      address: a.address ?? null,
      downloadState: downloadable && (a.url || a.mediaId) ? 'PENDING' : null,
    };
  }

  /** Фоновая загрузка входящего файла к себе: ссылки Meta протухают. */
  private async downloadAttachment(channel: MetaChannel, attachmentId: string, conversationId: string) {
    const att = await this.prisma.chatAttachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.downloadState !== 'PENDING') return;
    try {
      let buf: Buffer;
      let mime: string | null;
      if (channel === 'WHATSAPP') {
        if (!att.mediaId) throw new Error('нет id файла');
        const info = await this.wa.mediaInfo(att.mediaId);
        ({ buf, mime } = await this.media.download(info.url, this.tokens.whatsappToken()));
        mime = info.mime_type ?? mime;
      } else {
        if (!att.url) throw new Error('нет ссылки');
        ({ buf, mime } = await this.media.download(att.url));
      }
      let name = await this.media.save(buf, this.media.extFor(mime, att.name));
      let size = buf.length;
      let mimeType = (mime ?? '').split(';')[0] || att.mimeType;
      // Голосовые WhatsApp (Ogg/Opus) Safari на iPhone не играет — перегоняем в AAC.
      if (att.kind === 'AUDIO' && /ogg|opus/i.test(mimeType ?? '')) {
        const conv = await this.media.convert(name, 'm4a').catch(() => null);
        if (conv) {
          name = conv.name;
          size = conv.size;
          mimeType = 'audio/mp4';
        }
      }
      await this.prisma.chatAttachment.update({ where: { id: att.id }, data: { storedName: name, size, mimeType, downloadState: 'DONE' } });
    } catch (e) {
      this.logger.warn(`${channel}: файл вложения ${att.id} не скачан: ${(e as Error).message}`);
      await this.prisma.chatAttachment.update({ where: { id: att.id }, data: { downloadState: 'FAILED' } }).catch(() => undefined);
    }
    this.emit(conversationId, {});
  }

  /** Имени в уведомлении Instagram нет — спрашиваем профиль; фото храним у себя. */
  private async refreshInstagramProfile(conversationId: string, contactId: string) {
    const data: Prisma.ConversationUpdateInput = { profileCheckedAt: new Date() };
    try {
      const p = await this.ig.profile(contactId);
      if (p.name || p.username) data.title = p.name || p.username;
      if (p.username) data.username = p.username;
      if (p.profile_pic) {
        try {
          const { buf, mime } = await this.media.download(p.profile_pic);
          data.contactPicture = await this.media.save(buf, this.media.extFor(mime));
        } catch (e) {
          this.logger.warn(`Instagram: фото профиля не скачано: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      if (e instanceof MetaApiError && e.reason === 'TOKEN_INVALID') await this.tokens.markRefused('INSTAGRAM');
      this.logger.warn(`Instagram: профиль не получен: ${(e as MetaApiError).reason ?? (e as Error).message}`);
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data }).catch(() => undefined);
    this.emit(conversationId, {});
  }

  private async tryAutoLink(conversationId: string, phoneNormalized: string) {
    const apps = await this.prisma.application.findMany({
      where: { deletedAt: null, phoneNormalized },
      orderBy: { createdAt: 'desc' },
      select: { id: true, studentId: true },
      take: 3,
    });
    if (apps.length !== 1) return;
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { applicationId: apps[0].id, studentId: apps[0].studentId } }).catch(() => undefined);
  }

  private async notifyAllStaff(data: { type: string; title: string; message: string; payload?: any }) {
    const users = await this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const u of users) await this.notifications.notifyUser(u.id, data).catch(() => undefined);
  }

  private emit(conversationId: string, extra: Record<string, unknown>) {
    this.realtime.emitAllStaff('conversation:updated', { id: conversationId, ...extra });
  }

  // =================================================================== отправка

  private async loadConv(id: string): Promise<ConvRow> {
    const conv = await this.prisma.conversation.findFirst({ where: { id, deletedAt: null }, select: CONV_SELECT });
    if (!conv || !isMetaChannel(conv.channel)) throw new NotFoundException('Диалог не найден');
    return conv;
  }

  /** Отвечать в занятом чате могут ответственный и руководство. */
  private assertCanReply(conv: ConvRow, user: CurrentUser) {
    if (conv.assignedToId && conv.assignedToId !== user.id && !isPrivileged(user.role)) {
      throw new ForbiddenException(`Чат ведёт ${conv.assignedTo?.fullName ?? 'другой сотрудник'} — отвечать могут ответственный и руководство.`);
    }
  }

  private assertWindow(conv: ConvRow) {
    if (!conv.lastIncomingAt || Date.now() - conv.lastIncomingAt.getTime() > REPLY_WINDOW_MS) {
      throw new BadRequestException({ statusCode: 400, error: 'WINDOW_CLOSED', message: FAILURE_TEXT.WINDOW_CLOSED });
    }
  }

  private assertEnabled(channel: MetaChannel) {
    if (!configFor(channel).enabled) throw new BadRequestException(`${channel === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp'} ещё не подключён к CRM.`);
  }

  /** Кто первым ответил в свободной беседе, тот её и взял. */
  private async takeIfFree(conv: ConvRow, user: CurrentUser) {
    if (conv.assignedToId) return;
    await this.prisma.conversation.updateMany({ where: { id: conv.id, assignedToId: null }, data: { assignedToId: user.id } });
  }

  private publicUrl(name: string) {
    return `${publicApiUrl()}/api/public/chat-files/${name}`;
  }

  private async afterSend(conv: ConvRow, previewText: string, user: CurrentUser) {
    const now = new Date();
    await this.takeIfFree(conv, user);
    await this.prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now, lastMessageText: preview(previewText), unreadCount: 0 } });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'MESSAGE_SENT',
        studentId: conv.studentId,
        studentName: conv.title ?? null,
        details: `Ответ клиенту в ${conv.channel === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp'}: ${preview(previewText)}`,
      })
      .catch(() => undefined);
  }

  /** Отправить уже записанное сообщение (SENDING) и записать итог. */
  private async deliver(messageId: string) {
    const msg = await this.prisma.channelMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: { conversation: { select: { channel: true, externalId: true } }, chatAttachments: true },
    });
    const channel = msg.conversation.channel as MetaChannel;
    const to = msg.conversation.externalId;
    const att = msg.chatAttachments[0];
    try {
      let externalId: string | undefined;
      if (channel === 'INSTAGRAM') {
        if (att && att.kind !== 'LOCATION') {
          const type = att.kind === 'IMAGE' ? 'image' : att.kind === 'AUDIO' ? 'audio' : 'file';
          externalId = (await this.ig.sendAttachment(to, type, this.publicUrl(att.storedName!))).message_id;
        } else {
          externalId = (await this.ig.sendText(to, msg.text ?? '')).message_id;
        }
      } else if (att?.kind === 'LOCATION') {
        externalId = (await this.wa.sendLocation(to, att.latitude!, att.longitude!, att.name, att.address)).messages?.[0]?.id;
      } else if (att?.kind === 'IMAGE') {
        externalId = (await this.wa.sendImage(to, this.publicUrl(att.storedName!))).messages?.[0]?.id;
      } else if (att?.kind === 'FILE') {
        externalId = (await this.wa.sendDocument(to, this.publicUrl(att.storedName!), att.name || 'Документ.pdf')).messages?.[0]?.id;
      } else if (att?.kind === 'AUDIO') {
        externalId = (await this.wa.sendVoice(to, this.publicUrl(att.deliveryName ?? att.storedName!))).messages?.[0]?.id;
      } else {
        externalId = (await this.wa.sendText(to, msg.text ?? '')).messages?.[0]?.id;
      }
      const fresh = await this.prisma.channelMessage.findUniqueOrThrow({ where: { id: messageId }, select: { status: true, externalId: true } });
      await this.prisma.channelMessage
        .update({
          where: { id: messageId },
          data: {
            externalId: fresh.externalId ?? externalId ?? null,
            status: fresh.status === 'SENDING' || fresh.status === 'FAILED' ? 'SENT' : fresh.status,
            error: null,
            errorDetail: null,
          },
        })
        .catch(async (e) => {
          // Эхо уже записало это же сообщение отдельной строкой — статус всё равно отмечаем.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            await this.prisma.channelMessage.update({ where: { id: messageId }, data: { status: 'SENT', error: null, errorDetail: null } });
          } else throw e;
        });
      // Ключ снова работает — состояние канала перепроверим сразу, а не через 10 минут.
      if (await this.tokens.clearRefused(channel)) this.statusCache.delete(channel);
    } catch (e) {
      const err = e instanceof MetaApiError ? e : new MetaApiError('NETWORK', null, null, (e as Error).message);
      await this.prisma.channelMessage.update({ where: { id: messageId }, data: { status: 'FAILED', error: err.reason, errorDetail: err.detail } });
      if (err.reason === 'TOKEN_INVALID') await this.tokens.markRefused(channel);
      this.logger.warn(`${channel}: сообщение ${messageId} не ушло: ${err.reason} ${err.detail ?? ''}`.trim());
    }
  }

  private async messageOut(id: string) {
    return this.prisma.channelMessage.findUniqueOrThrow({ where: { id }, include: MESSAGE_INCLUDE });
  }

  async sendText(conversationId: string, rawText: string, user: CurrentUser) {
    const conv = await this.loadConv(conversationId);
    this.assertEnabled(conv.channel as MetaChannel);
    this.assertCanReply(conv, user);
    this.assertWindow(conv);
    const text = rawText.trim();
    if (!text) throw new BadRequestException('Пустое сообщение');
    const parts = splitByBytes(text, TEXT_LIMIT_BYTES[conv.channel as MetaChannel]);
    const ids: string[] = [];
    for (const part of parts) {
      const m = await this.prisma.channelMessage.create({
        data: { conversationId, direction: MessageDirection.OUTBOUND, text: part, status: 'SENDING', authorId: user.id, sentAt: new Date() },
        select: { id: true },
      });
      ids.push(m.id);
      this.emit(conversationId, {});
      await this.deliver(m.id);
    }
    await this.afterSend(conv, text, user);
    this.emit(conversationId, {});
    return Promise.all(ids.map((id) => this.messageOut(id)));
  }

  async sendFile(conversationId: string, file: { buffer: Buffer; originalname: string; size: number } | undefined, user: CurrentUser) {
    const conv = await this.loadConv(conversationId);
    const channel = conv.channel as MetaChannel;
    this.assertEnabled(channel);
    this.assertCanReply(conv, user);
    this.assertWindow(conv);
    if (!file?.buffer?.length) throw new BadRequestException('Файл не получен');
    const type = sniff(file.buffer);
    if (type !== 'jpg' && type !== 'png' && type !== 'pdf') throw new BadRequestException('Можно отправить фото JPG или PNG либо документ PDF.');
    const isImage = type !== 'pdf';
    const limit = isImage ? (channel === 'WHATSAPP' ? OUTGOING_LIMITS.imageWhatsapp : OUTGOING_LIMITS.imageInstagram) : OUTGOING_LIMITS.pdf;
    if (file.size > limit) throw new BadRequestException(`Файл больше ${Math.round(limit / 1048576)} МБ — ${isImage ? 'сожмите фото' : 'уменьшите PDF'}.`);
    const mime = type === 'pdf' ? 'application/pdf' : type === 'png' ? 'image/png' : 'image/jpeg';
    const storedName = await this.media.save(file.buffer, `.${type}`);
    const originalName = (file.originalname || (isImage ? 'Фото' : 'Документ.pdf')).slice(0, 200);
    const m = await this.prisma.channelMessage.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        text: null,
        status: 'SENDING',
        authorId: user.id,
        sentAt: new Date(),
        chatAttachments: { create: [{ kind: isImage ? 'IMAGE' : 'FILE', storedName, mimeType: mime, size: file.size, name: originalName, isPublic: true, downloadState: 'DONE' }] },
      },
      select: { id: true },
    });
    this.emit(conversationId, {});
    await this.deliver(m.id);
    await this.afterSend(conv, isImage ? '[фото]' : `[файл] ${originalName}`, user);
    this.emit(conversationId, {});
    return this.messageOut(m.id);
  }

  async sendVoice(conversationId: string, file: { buffer: Buffer; size: number } | undefined, user: CurrentUser) {
    const conv = await this.loadConv(conversationId);
    const channel = conv.channel as MetaChannel;
    this.assertEnabled(channel);
    this.assertCanReply(conv, user);
    this.assertWindow(conv);
    if (!this.media.ffmpegAvailable()) throw new BadRequestException('Голосовые временно недоступны на сервере.');
    if (!file?.buffer?.length) throw new BadRequestException('Запись не получена');
    if (file.size > OUTGOING_LIMITS.voice) throw new BadRequestException('Голосовое больше 10 МБ.');
    const type = sniff(file.buffer);
    if (!type || !['webm', 'ogg', 'mp4', 'wav'].includes(type)) throw new BadRequestException('Неизвестный формат записи.');
    const source = await this.media.save(file.buffer, `.${type === 'mp4' ? 'm4a' : type}`);
    const m4a = await this.media.convert(source, 'm4a');
    const ogg = channel === 'WHATSAPP' ? await this.media.convert(source, 'ogg') : null;
    await fs.promises.unlink(this.media.filePath(source)).catch(() => undefined);
    if (!m4a || (channel === 'WHATSAPP' && !ogg)) throw new BadRequestException('Не удалось обработать запись.');
    const m = await this.prisma.channelMessage.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        text: null,
        status: 'SENDING',
        authorId: user.id,
        sentAt: new Date(),
        chatAttachments: {
          create: [{ kind: 'AUDIO', storedName: m4a.name, deliveryName: ogg?.name ?? null, mimeType: 'audio/mp4', size: m4a.size, name: 'Голосовое', isPublic: true, downloadState: 'DONE' }],
        },
      },
      select: { id: true },
    });
    this.emit(conversationId, {});
    await this.deliver(m.id);
    await this.afterSend(conv, '[голосовое]', user);
    this.emit(conversationId, {});
    return this.messageOut(m.id);
  }

  async sendLocation(conversationId: string, dto: { latitude: number; longitude: number; name?: string; address?: string }, user: CurrentUser) {
    const conv = await this.loadConv(conversationId);
    const channel = conv.channel as MetaChannel;
    this.assertEnabled(channel);
    this.assertCanReply(conv, user);
    this.assertWindow(conv);
    const { latitude, longitude } = dto;
    if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) throw new BadRequestException('Неверные координаты');
    const name = dto.name?.trim().slice(0, 200) || null;
    const address = dto.address?.trim().slice(0, 300) || null;
    // Instagram получает текст — его же и храним, чтобы эхо совпало с сообщением.
    const text = channel === 'INSTAGRAM' ? locationText(latitude, longitude, name, address) : null;
    const m = await this.prisma.channelMessage.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        text,
        status: 'SENDING',
        authorId: user.id,
        sentAt: new Date(),
        chatAttachments: { create: [{ kind: 'LOCATION', latitude, longitude, name, address }] },
      },
      select: { id: true },
    });
    this.emit(conversationId, {});
    await this.deliver(m.id);
    await this.afterSend(conv, `[место] ${name ?? address ?? ''}`.trim(), user);
    this.emit(conversationId, {});
    return this.messageOut(m.id);
  }

  /** Повтор неушедшего; текстовое можно повторить с исправленным текстом на том же месте. */
  async retry(messageId: string, newText: string | undefined, user: CurrentUser) {
    const msg = await this.prisma.channelMessage.findFirst({
      where: { id: messageId, direction: MessageDirection.OUTBOUND, deletedAt: null },
      include: { chatAttachments: { select: { id: true } } },
    });
    if (!msg) throw new NotFoundException('Сообщение не найдено');
    const conv = await this.loadConv(msg.conversationId);
    this.assertEnabled(conv.channel as MetaChannel);
    this.assertCanReply(conv, user);
    if (msg.status !== 'FAILED') throw new ConflictException('Повторить можно только неотправленное сообщение');
    this.assertWindow(conv);
    const data: Prisma.ChannelMessageUpdateInput = { status: 'SENDING', error: null, errorDetail: null, sentAt: new Date() };
    if (newText !== undefined) {
      const t = newText.trim();
      if (msg.chatAttachments.length) throw new BadRequestException('Сообщение с файлом повторяется только как было');
      if (!t) throw new BadRequestException('Пустое сообщение');
      if (Buffer.byteLength(t, 'utf8') > TEXT_LIMIT_BYTES[conv.channel as MetaChannel]) throw new BadRequestException('Текст длиннее, чем принимает мессенджер');
      data.text = t;
    }
    await this.prisma.channelMessage.update({ where: { id: messageId }, data });
    this.emit(conv.id, {});
    await this.deliver(messageId);
    this.emit(conv.id, {});
    return this.messageOut(messageId);
  }

  // =================================================================== чат

  async take(conversationId: string, user: CurrentUser) {
    const conv = await this.loadConv(conversationId);
    if (conv.assignedToId && conv.assignedToId !== user.id) {
      throw new ConflictException(`Чат уже ведёт ${conv.assignedTo?.fullName ?? 'другой сотрудник'}`);
    }
    const res = await this.prisma.conversation.updateMany({ where: { id: conv.id, assignedToId: null }, data: { assignedToId: user.id } });
    if (!res.count && conv.assignedToId !== user.id) throw new ConflictException('Чат только что взял другой сотрудник');
    this.emit(conv.id, {});
    return { ok: true };
  }

  async release(conversationId: string, user: CurrentUser) {
    const conv = await this.loadConv(conversationId);
    if (conv.assignedToId !== user.id && !isPrivileged(user.role)) throw new ForbiddenException('Отпустить чат может ответственный или руководство');
    await this.prisma.conversation.update({ where: { id: conv.id }, data: { assignedToId: null } });
    this.emit(conv.id, {});
    return { ok: true };
  }

  /** «Создать заявку» из чата: имя, телефон и источник — из чата, направление выбирает менеджер. */
  async createApplication(conversationId: string, dto: { fullName: string; phone: string; direction: Direction; comment?: string }, user: CurrentUser) {
    const conv = await this.loadConv(conversationId);
    // В занятом чате заявку создают ответственный и руководство (как и отвечают).
    if (conv.assignedToId && conv.assignedToId !== user.id && !isPrivileged(user.role)) {
      throw new ForbiddenException(`Чат ведёт ${conv.assignedTo?.fullName ?? 'другой сотрудник'} — заявку из него создают ответственный и руководство.`);
    }
    if (conv.applicationId || conv.studentId) throw new ConflictException('Чат уже привязан к карточке');
    const phone = dto.phone.trim();
    const phoneNormalized = normalizePhone(phone);
    const repeatOfId = await findRepeatOfId(this.prisma, phoneNormalized, null);
    // Менеджер заявки — тот, кто ведёт чат: руководитель, создав заявку из чата
    // менеджера, не забирает его клиента. Свободный чат — создатель и берёт.
    const owner = conv.assignedTo && !conv.assignedTo.deletedAt ? conv.assignedTo : { id: user.id, region: user.region };
    const field = owner.region === 'CN' ? 'chinaManagerId' : 'managerId';
    const app = await this.prisma.application.create({
      data: {
        fullName: dto.fullName.trim(),
        phone,
        phoneNormalized,
        direction: dto.direction,
        comment: dto.comment?.trim() || null,
        source: conv.channel,
        sourceDetail: conv.username ? `@${conv.username}` : conv.channel === 'WHATSAPP' ? conv.phone : null,
        [field]: owner.id,
        repeatOfId,
      },
      select: { id: true, managerId: true, fullName: true },
    });
    await claimFirstTouch(this.prisma, app.id, app.managerId, user.id);
    await this.prisma.conversation.update({ where: { id: conv.id }, data: { applicationId: app.id, assignedToId: conv.assignedToId ?? owner.id } });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'CONVERSATION_LINK',
        studentName: app.fullName,
        details: `Из чата ${conv.channel === 'INSTAGRAM' ? 'Instagram' : 'WhatsApp'} создана заявка: ${app.fullName}`,
      })
      .catch(() => undefined);
    this.realtime.emitAllStaff('application:new', { id: app.id });
    this.emit(conv.id, {});
    return { applicationId: app.id };
  }

  // =================================================================== файлы

  async attachmentFile(attachmentId: string): Promise<{ path: string; mime: string | null; name: string | null }> {
    const att = await this.prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      select: { storedName: true, mimeType: true, name: true, message: { select: { conversation: { select: { channel: true, deletedAt: true } } } } },
    });
    if (!att?.storedName || !isMetaChannel(att.message.conversation.channel) || att.message.conversation.deletedAt) throw new NotFoundException('Файл не найден');
    return { path: this.media.filePath(att.storedName), mime: att.mimeType, name: att.name };
  }

  async pictureFile(conversationId: string): Promise<string> {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, deletedAt: null }, select: { contactPicture: true, channel: true } });
    if (!conv?.contactPicture || !isMetaChannel(conv.channel)) throw new NotFoundException('Фото нет');
    return this.media.filePath(conv.contactPicture);
  }

  /** Без входа: только наши отправленные файлы (isPublic) — их забирает Meta. */
  async publicFile(name: string): Promise<{ path: string; mime: string | null }> {
    const clean = name.replace(/[^a-zA-Z0-9.\-]/g, '');
    if (!clean || clean !== name) throw new NotFoundException();
    const att = await this.prisma.chatAttachment.findFirst({
      where: { isPublic: true, OR: [{ storedName: clean }, { deliveryName: clean }] },
      select: { storedName: true, deliveryName: true, mimeType: true },
    });
    if (!att) throw new NotFoundException();
    const isDelivery = att.deliveryName === clean;
    return { path: this.media.filePath(clean), mime: isDelivery ? 'audio/ogg' : att.mimeType };
  }

  // =================================================================== состояние

  /** Для «Диалогов»: не настроен / настроен не полностью / подключён / ключ отказан. */
  async channelStatus() {
    const out: Array<{ value: MetaChannel; enabled: boolean; state: 'NOT_CONFIGURED' | 'MISCONFIGURED' | 'TOKEN_REFUSED' | 'CONNECTED'; account: string | null; missing: string[]; tokenExpiresAt: string | null }> = [];
    for (const channel of ['INSTAGRAM', 'WHATSAPP'] as const) {
      const cfg = configFor(channel);
      if (!cfg.enabled) {
        out.push({ value: channel, enabled: false, state: cfg.missing.length ? 'MISCONFIGURED' : 'NOT_CONFIGURED', account: null, missing: cfg.missing, tokenExpiresAt: null });
        continue;
      }
      let account: string | null = null;
      const cached = this.statusCache.get(channel);
      if (cached && Date.now() < cached.until) account = cached.account;
      else {
        let ok = false;
        try {
          if (channel === 'INSTAGRAM') {
            const me = await this.ig.me();
            account = me.username ? `@${me.username}` : null;
            const id = me.user_id ?? me.id;
            if (id && id !== cfg.accountId) account = `${account ?? ''} (id ${id} не совпадает с INSTAGRAM_ACCOUNT_ID)`.trim();
          } else {
            const p = await this.wa.phoneInfo();
            account = [p.display_phone_number, p.verified_name].filter(Boolean).join(' · ') || null;
          }
          await this.tokens.clearRefused(channel);
          ok = true;
        } catch (e) {
          if (e instanceof MetaApiError && e.reason === 'TOKEN_INVALID') await this.tokens.markRefused(channel);
        }
        // Удачную проверку помним 10 минут, неудачную — минуту (чтобы исправленный ключ было видно сразу).
        this.statusCache.set(channel, { until: Date.now() + (ok ? 10 * 60_000 : 60_000), account });
      }
      const refused = await this.tokens.isRefused(channel);
      out.push({
        value: channel,
        enabled: true,
        state: refused ? 'TOKEN_REFUSED' : 'CONNECTED',
        account,
        missing: [],
        tokenExpiresAt: channel === 'INSTAGRAM' ? await this.tokens.instagramTokenExpiresAt() : null,
      });
    }
    return out;
  }
}

/** Проверка вебхука: какие переменные не заданы — для журнала на старте. */
export function logMetaConfig(logger: Logger) {
  for (const [label, cfg] of [['Instagram', instagramConfig()], ['WhatsApp', whatsappConfig()]] as const) {
    if (cfg.missing.length) logger.error(`${label}: настроено не полностью, не хватает ${cfg.missing.join(', ')}`);
    else if (cfg.enabled) logger.log(`${label}: подключён (аккаунт ${cfg.accountId})`);
  }
}
