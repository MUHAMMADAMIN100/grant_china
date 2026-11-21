import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Direction, MessageDirection, Prisma, Role } from '@prisma/client';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../../activity/activity.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { normalizePhone } from '../../common/phone';
import { findRepeatOfId } from '../../common/application-repeat';
import { callGemini, GeminiError, type GeminiTurn } from '../../ai/gemini';
import { MetaChatsService } from '../meta/meta-chats.service';
import { MetaMediaService } from '../meta/meta.media';
import { instagramConfig, REPLY_WINDOW_MS } from '../meta/meta.config';
import {
  AI_REPLY_SCHEMA,
  buildSystemPrompt,
  DIRECTION_LABEL,
  DIRECTION_VALUES,
  NOTES_TEMPLATE,
  parseAiReply,
  type AiLead,
  type AiReply,
} from './chat-ai.prompt';

type CurrentUser = { id: string; role: Role; fullName?: string };

/** Настройки ИИ в IntegrationState под этим ключом. */
const SETTINGS_KEY = 'aiChat';

export interface AiChatSettings {
  enabled: boolean;
  notes: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

/**
 * Модель для ответов клиентам. Flash — быстрая: клиент в мессенджере ждёт
 * секунды, а не полминуты, как помощник сотрудников на Pro. Можно сменить
 * переменной AI_CHAT_MODEL без выката кода.
 */
const DEFAULT_MODEL = 'gemini-flash-latest';
/** Запасная модель, если основная перегружена (503/429) или недоступна. */
const FALLBACK_MODEL = 'gemini-pro-latest';

/** Клиент часто пишет несколькими сообщениями подряд — ждём паузу, отвечаем на всё сразу. */
const DEBOUNCE_MS = Number(process.env.AI_CHAT_DEBOUNCE_MS) || 5000;
/** Отвечаем только на свежие сообщения: после включения ИИ или перезапуска он не разбирает старые хвосты. */
const FRESH_MS = 20 * 60_000;
/** Сколько последних сообщений переписки видит модель. */
const HISTORY = 40;
/** Предохранитель от бесконечной переписки и расходов: столько ответов ИИ в чате за сутки. */
const MAX_AI_PER_DAY = 40;
/** Фото и голосовые — только из последних сообщений клиента, не больше стольких и такого размера. */
const MAX_MEDIA = 4;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
/** Файл клиента ещё качается — ждём его до стольких раз по 4 секунды. */
const MEDIA_WAIT_TRIES = 6;
/** Каталог программ в промпте — кэш на 5 минут. */
const CATALOG_TTL_MS = 5 * 60_000;

const KIND_TEXT: Record<string, string> = {
  IMAGE: '[фото]',
  VIDEO: '[видео]',
  AUDIO: '[голосовое сообщение]',
  FILE: '[файл]',
  STICKER: '[стикер]',
  SHARE: '[публикация из Instagram]',
  REEL: '[reels из Instagram]',
  STORY: '[ответ на историю Instagram]',
  LOCATION: '[место на карте]',
  CONTACT: '[контакт]',
  UNSUPPORTED: '[сообщение, которое не видно]',
};

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/**
 * 21.11.2026 — ИИ-помощник отвечает клиентам в Instagram Direct.
 *
 * Как работает:
 *  1. Новое сообщение клиента (MetaChatsService.onInbound) ставит чат в очередь
 *     с паузой 5 секунд — клиент часто пишет несколькими сообщениями подряд.
 *  2. Отвечает, только если: ИИ включён руководством, чат свободный (никто его
 *     не ведёт), в этом чате ИИ не выключали, последнее сообщение — клиента,
 *     оно свежее и окно 24 часа открыто.
 *  3. Пока модель думает, клиент видит «печатает…», сотрудники — «ИИ печатает…».
 *  4. Если за это время клиент дописал — ответ выбрасывается и готовится заново
 *     уже на всё; если чат взял менеджер — ответ не уходит.
 *  5. Из ответа модели: текст клиенту, данные клиента (имя, телефон, возраст,
 *     интерес, уровень) и признак «нужен менеджер». Есть имя и телефон, а
 *     карточки у чата нет — создаётся заявка (источник Instagram) и чат
 *     привязывается к ней; «нужен менеджер» — уведомление всем сотрудникам.
 *
 * Сервер один (Railway), поэтому очередь — в памяти процесса. Перезапуск при
 * выкате теряет только ожидающие 5 секунд; старые сообщения ИИ не разбирает.
 */
@Injectable()
export class ChatAiService implements OnModuleInit {
  private readonly logger = new Logger(ChatAiService.name);
  private readonly apiKey: string | null;
  private readonly model: string;

  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = new Set<string>();
  private dirty = new Set<string>();
  private mediaWaits = new Map<string, number>();
  private catalogCache: { at: number; text: string; count: number } | null = null;

  constructor(
    config: ConfigService,
    private prisma: PrismaService,
    private meta: MetaChatsService,
    private media: MetaMediaService,
    private realtime: RealtimeGateway,
    private activity: ActivityService,
  ) {
    this.apiKey = config.get<string>('GEMINI_API_KEY') || config.get<string>('GOOGLE_API_KEY') || null;
    this.model = config.get<string>('AI_CHAT_MODEL') || DEFAULT_MODEL;
  }

  onModuleInit() {
    this.meta.onInbound((id, channel) => {
      if (channel === 'INSTAGRAM') this.schedule(id);
    });
  }

  isAvailable() {
    return !!this.apiKey;
  }

  // =================================================================== настройки

  async settings(): Promise<AiChatSettings> {
    const row = await this.prisma.integrationState.findUnique({ where: { key: SETTINGS_KEY } });
    const v = (row?.value ?? {}) as Partial<AiChatSettings>;
    return {
      enabled: v.enabled === true,
      notes: typeof v.notes === 'string' ? v.notes : '',
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null,
      updatedByName: typeof v.updatedByName === 'string' ? v.updatedByName : null,
    };
  }

  /** Для CRM: настройки + есть ли ключ, подключён ли Instagram, какая модель. */
  async publicSettings() {
    const s = await this.settings();
    return { ...s, available: this.isAvailable(), instagram: instagramConfig().enabled, model: this.model, template: NOTES_TEMPLATE };
  }

  async saveSettings(dto: { enabled?: boolean; notes?: string }, user: CurrentUser) {
    const cur = await this.settings();
    if (dto.enabled === true && !this.isAvailable()) {
      throw new BadRequestException('ИИ нельзя включить: на сервере не задан ключ GEMINI_API_KEY.');
    }
    const actor = await this.prisma.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    const next: AiChatSettings = {
      enabled: dto.enabled ?? cur.enabled,
      notes: dto.notes !== undefined ? dto.notes.slice(0, 30000) : cur.notes,
      updatedAt: new Date().toISOString(),
      updatedByName: actor?.fullName ?? null,
    };
    await this.prisma.integrationState.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    const changes: string[] = [];
    if (next.enabled !== cur.enabled) changes.push(next.enabled ? 'ИИ-помощник включён' : 'ИИ-помощник выключен');
    if (next.notes !== cur.notes) changes.push('изменена памятка для ИИ');
    if (changes.length) {
      this.activity
        .log({ actorId: user.id, actorRole: user.role, action: 'AI_CHAT_SETTINGS', details: `Instagram: ${changes.join(', ')}` })
        .catch(() => undefined);
    }
    this.realtime.emitAllStaff('ai-chat:settings', { enabled: next.enabled });
    return this.publicSettings();
  }

  // =================================================================== очередь

  /** Поставить чат в очередь на ответ (с паузой — вдруг клиент допишет). */
  schedule(conversationId: string, delay = DEBOUNCE_MS) {
    if (!this.apiKey) return;
    if (this.running.has(conversationId)) {
      // Модель уже думает над этим чатом — по окончании ответ проверит свежесть и перезапустится.
      this.dirty.add(conversationId);
      return;
    }
    const prev = this.timers.get(conversationId);
    if (prev) clearTimeout(prev);
    this.timers.set(
      conversationId,
      setTimeout(() => {
        this.timers.delete(conversationId);
        void this.run(conversationId);
      }, delay),
    );
  }

  private async run(conversationId: string) {
    if (this.running.has(conversationId)) {
      this.dirty.add(conversationId);
      return;
    }
    this.running.add(conversationId);
    try {
      await this.runOnce(conversationId);
    } catch (e) {
      this.logger.warn(`ИИ: чат ${conversationId}: ${(e as Error).message}`);
    } finally {
      this.running.delete(conversationId);
      if (this.dirty.delete(conversationId)) this.schedule(conversationId, 1500);
    }
  }

  private async runOnce(conversationId: string) {
    const settings = await this.settings();
    if (!settings.enabled || !instagramConfig().enabled) return;
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: {
        id: true,
        channel: true,
        externalId: true,
        title: true,
        username: true,
        assignedToId: true,
        aiOff: true,
        aiHandoffAt: true,
        lastIncomingAt: true,
        applicationId: true,
        studentId: true,
        application: { select: { fullName: true, phone: true } },
        student: { select: { fullName: true } },
      },
    });
    if (!conv || conv.channel !== 'INSTAGRAM' || conv.assignedToId || conv.aiOff) return;
    if (!conv.lastIncomingAt || Date.now() - conv.lastIncomingAt.getTime() > REPLY_WINDOW_MS) return;

    const recent = await this.prisma.channelMessage.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { sentAt: 'desc' },
      take: HISTORY,
      include: { chatAttachments: { select: { kind: true, storedName: true, mimeType: true, size: true, downloadState: true, url: true } } },
    });
    const last = recent[0];
    if (!last || last.direction !== MessageDirection.INBOUND) return; // уже ответили
    if (Date.now() - last.sentAt.getTime() > FRESH_MS) return;

    const dayAgo = new Date(Date.now() - 86400_000);
    const aiToday = await this.prisma.channelMessage.count({ where: { conversationId, byAi: true, sentAt: { gte: dayAgo } } });
    if (aiToday >= MAX_AI_PER_DAY) {
      await this.handoff(conv, `ИИ ответил в этом чате уже ${aiToday} раз за сутки — дальше нужен менеджер.`);
      return;
    }

    // Неотвеченные сообщения клиента — от последнего нашего ответа до конца.
    const chrono = [...recent].reverse();
    let firstUnanswered = chrono.length;
    for (let i = chrono.length - 1; i >= 0 && chrono[i].direction === MessageDirection.INBOUND; i--) firstUnanswered = i;
    const unanswered = chrono.slice(firstUnanswered);
    if (unanswered.some((m) => m.chatAttachments.some((a) => a.downloadState === 'PENDING'))) {
      const tries = (this.mediaWaits.get(conversationId) ?? 0) + 1;
      if (tries <= MEDIA_WAIT_TRIES) {
        this.mediaWaits.set(conversationId, tries);
        this.schedule(conversationId, 4000);
        return;
      }
    }
    this.mediaWaits.delete(conversationId);

    const turns = await this.buildTurns(chrono, firstUnanswered);
    this.meta.sendTyping(conv.id, conv.externalId);
    this.meta.emitTyping(conv.id, true);
    let result: AiReply;
    try {
      result = await this.generate({
        notes: settings.notes,
        turns,
        client: { name: conv.title, username: conv.username },
        existingCard: conv.application
          ? { fullName: conv.application.fullName, phone: conv.application.phone }
          : conv.student
            ? { fullName: conv.student.fullName, phone: null }
            : null,
      });
    } catch (e) {
      this.logger.warn(`ИИ не ответил в чате ${conversationId}: ${(e as Error).message}`);
      await this.handoff(conv, 'ИИ не смог подготовить ответ (сбой сервиса Gemini) — ответьте клиенту сами.');
      return;
    } finally {
      this.meta.emitTyping(conv.id, false);
    }

    // Пока модель думала, мир мог измениться.
    const fresh = await this.prisma.conversation.findFirst({ where: { id: conversationId, deletedAt: null }, select: { assignedToId: true, aiOff: true } });
    if (!fresh || fresh.assignedToId || fresh.aiOff) return;
    const newest = await this.prisma.channelMessage.findFirst({
      where: { conversationId, deletedAt: null },
      orderBy: { sentAt: 'desc' },
      select: { id: true, direction: true },
    });
    if (newest?.id !== last.id) {
      if (newest?.direction === MessageDirection.INBOUND) this.dirty.add(conversationId); // клиент дописал — ответим на всё
      return;
    }
    if (!(await this.settings()).enabled) return;

    if (result.reply) await this.meta.sendAsAi(conversationId, result.reply);
    if (!conv.applicationId && !conv.studentId && result.lead) await this.maybeCreateApplication(conversationId, result.lead).catch((e) => this.logger.warn(`ИИ: заявка не создана: ${(e as Error).message}`));
    if (result.handoff) await this.handoff(conv, result.handoffReason || 'Клиенту нужен менеджер.');
    else if (!result.reply) this.meta.touch(conversationId);
  }

  /** Переписка → реплики модели. Фото и голосовые — только из неотвеченных сообщений клиента. */
  private async buildTurns(
    chrono: Array<
      Prisma.ChannelMessageGetPayload<{ include: { chatAttachments: { select: { kind: true; storedName: true; mimeType: true; size: true; downloadState: true; url: true } } } }>
    >,
    firstUnanswered: number,
  ): Promise<GeminiTurn[]> {
    const turns: GeminiTurn[] = [];
    let mediaLeft = MAX_MEDIA;
    for (let i = 0; i < chrono.length; i++) {
      const m = chrono[i];
      const role: GeminiTurn['role'] = m.direction === MessageDirection.INBOUND ? 'user' : 'model';
      const pieces: string[] = [];
      const media: NonNullable<GeminiTurn['media']> = [];
      if (m.deletedByContactAt) pieces.push('[клиент удалил это сообщение]');
      else {
        for (const a of m.chatAttachments) {
          let attached = false;
          if (role === 'user' && i >= firstUnanswered && mediaLeft > 0 && a.storedName && a.downloadState !== 'FAILED') {
            attached = await this.attachMedia(a, media);
            if (attached) mediaLeft--;
          }
          const label = KIND_TEXT[a.kind] ?? '[вложение]';
          pieces.push(attached ? label.replace(']', ' — приложено]') : label);
        }
        if (m.text) pieces.push(m.text);
      }
      const text = pieces.join('\n') || '[пустое сообщение]';
      const prev = turns[turns.length - 1];
      if (prev && prev.role === role) {
        prev.text = `${prev.text}\n${text}`;
        if (media.length) prev.media = [...(prev.media ?? []), ...media];
      } else {
        turns.push({ role, text, ...(media.length ? { media } : {}) });
      }
    }
    // Разговор для модели начинается с клиента.
    if (turns[0]?.role === 'model') turns.unshift({ role: 'user', text: '[начало переписки]' });
    return turns;
  }

  private async attachMedia(a: { kind: string; storedName: string | null; mimeType: string | null; size: number | null }, out: NonNullable<GeminiTurn['media']>): Promise<boolean> {
    if (!a.storedName) return false;
    try {
      if (a.kind === 'IMAGE' && IMAGE_MIME.has((a.mimeType ?? '').toLowerCase()) && (a.size ?? 0) <= MAX_IMAGE_BYTES) {
        const buf = await fs.promises.readFile(this.media.filePath(a.storedName));
        out.push({ mimeType: (a.mimeType ?? 'image/jpeg').toLowerCase(), data: buf.toString('base64') });
        return true;
      }
      if (a.kind === 'AUDIO') {
        const wav = await this.media.audioForAi(a.storedName);
        if (!wav) return false;
        out.push({ mimeType: 'audio/wav', data: wav.toString('base64') });
        return true;
      }
    } catch (e) {
      this.logger.warn(`ИИ: файл клиента не прочитан: ${(e as Error).message}`);
    }
    return false;
  }

  // =================================================================== модель

  private async catalog(): Promise<{ text: string; count: number }> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CATALOG_TTL_MS) return this.catalogCache;
    const programs = await this.prisma.program.findMany({
      where: { deletedAt: null, published: true },
      orderBy: [{ direction: 'asc' }, { university: 'asc' }],
      select: { name: true, university: true, city: true, major: true, direction: true, cost: true, semesterCost: true, currency: true, duration: true, language: true, description: true },
      take: 300,
    });
    const money = (n: number, cur: string) => `${new Intl.NumberFormat('ru-RU').format(n)} ${cur === 'CNY' ? 'юаней' : cur}`;
    const lines = programs.map((p) => {
      const price = [p.cost != null ? `${money(p.cost, p.currency)} в год` : null, p.semesterCost != null ? `${money(p.semesterCost, p.currency)} за семестр` : null]
        .filter(Boolean)
        .join(', ');
      const desc = p.description ? p.description.replace(/\s+/g, ' ').trim() : '';
      return [
        `— ${p.name}: ${p.university}, город ${p.city}. Уровень: ${DIRECTION_LABEL[p.direction]}. Специальность: ${p.major}.`,
        price ? ` Стоимость: ${price}.` : '',
        p.duration ? ` Срок: ${p.duration}.` : '',
        p.language ? ` Язык обучения: ${p.language}.` : '',
        desc ? ` Описание: ${desc.length > 500 ? `${desc.slice(0, 500)}…` : desc}` : '',
      ].join('');
    });
    this.catalogCache = { at: Date.now(), text: lines.join('\n'), count: programs.length };
    return this.catalogCache;
  }

  private async generate(input: {
    notes: string;
    turns: GeminiTurn[];
    client: { name: string | null; username: string | null } | null;
    existingCard: { fullName: string; phone: string | null } | null;
  }): Promise<AiReply> {
    if (!this.apiKey) throw new ServiceUnavailableException('ИИ недоступен: на сервере не задан ключ GEMINI_API_KEY.');
    const cat = await this.catalog();
    const system = buildSystemPrompt({
      notes: input.notes,
      catalog: cat.text,
      catalogCount: cat.count,
      account: null,
      client: input.client,
      existingCard: input.existingCard,
      now: new Date(),
    });
    const call = (model: string) =>
      callGemini({
        model,
        apiKey: this.apiKey!,
        system,
        turns: input.turns,
        maxOutputTokens: 4096,
        thinkingBudget: 1024,
        timeoutSec: 45,
        responseSchema: AI_REPLY_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0.5,
      });
    let res;
    try {
      res = await call(this.model);
    } catch (e) {
      const status = (e as GeminiError).status;
      if (e instanceof GeminiError && (status === 429 || status === 503 || status === 500 || status === 404) && this.model !== FALLBACK_MODEL) {
        this.logger.warn(`ИИ: модель «${this.model}» не ответила (${status}), пробую «${FALLBACK_MODEL}»`);
        res = await call(FALLBACK_MODEL);
      } else throw e;
    }
    if (res.finishReason === 'SAFETY') {
      return { reply: '', handoff: true, handoffReason: 'ИИ не стал отвечать на это сообщение (правила безопасности Gemini) — ответьте сами.', lead: null };
    }
    const parsed = parseAiReply(res.text);
    if (!parsed) throw new Error(`ответ модели не разобран: ${res.text.slice(0, 200)}`);
    return parsed;
  }

  /**
   * «Проверить ИИ» в настройках: переписка, которую руководство набирает как
   * клиент, и памятка из поля (даже несохранённая). Ничего не уходит в
   * Instagram, ничего не пишется в базу.
   */
  async test(dto: { messages: Array<{ from: 'client' | 'ai'; text: string }>; notes?: string }) {
    const settings = await this.settings();
    const turns: GeminiTurn[] = [];
    for (const m of dto.messages.slice(-30)) {
      const role: GeminiTurn['role'] = m.from === 'client' ? 'user' : 'model';
      const text = (m.text ?? '').slice(0, 2000).trim();
      if (!text) continue;
      const prev = turns[turns.length - 1];
      if (prev && prev.role === role) prev.text += `\n${text}`;
      else turns.push({ role, text });
    }
    if (!turns.length || turns[turns.length - 1].role !== 'user') throw new BadRequestException('Последним должно быть сообщение клиента');
    if (turns[0].role === 'model') turns.unshift({ role: 'user', text: '[начало переписки]' });
    const started = Date.now();
    try {
      const r = await this.generate({ notes: dto.notes ?? settings.notes, turns, client: null, existingCard: null });
      return { ...r, ms: Date.now() - started, model: this.model };
    } catch (e) {
      if (e instanceof GeminiError) throw new ServiceUnavailableException(`Gemini не ответил: ${e.message}`);
      throw e;
    }
  }

  // =================================================================== последствия

  /** Есть имя и телефон, а карточки у чата нет — заявка из Instagram. */
  private async maybeCreateApplication(conversationId: string, lead: AiLead) {
    const fullName = (lead.fullName ?? '').replace(/\s+/g, ' ').trim();
    const phone = (lead.phone ?? '').trim();
    const phoneNormalized = normalizePhone(phone);
    if (fullName.length < 2 || !phoneNormalized || phoneNormalized.replace(/\D/g, '').length < 9) return;
    const known = DIRECTION_VALUES.includes(lead.direction as Direction);
    // Уровень обязателен в заявке. Не назвал — ставим бакалавриат и честно
    // пишем в комментарии, что его надо уточнить.
    const direction: Direction = known ? (lead.direction as Direction) : 'BACHELOR';
    const repeatOfId = await findRepeatOfId(this.prisma, phoneNormalized, null);
    const created = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { applicationId: true, studentId: true, username: true, title: true } });
      if (!conv || conv.applicationId || conv.studentId) return null;
      const comment = [
        lead.age ? `Возраст / класс: ${lead.age}` : null,
        lead.interest ? `Интересует: ${lead.interest}` : null,
        known ? null : 'Уровень ИИ не узнал — уточните (стоит «Бакалавриат» по умолчанию).',
        `Заявку создал ИИ-помощник по переписке в Instagram${conv.username ? ` (@${conv.username})` : ''}.`,
      ]
        .filter(Boolean)
        .join('\n');
      const app = await tx.application.create({
        data: {
          fullName: fullName.slice(0, 120),
          phone: phone.slice(0, 30),
          phoneNormalized,
          direction,
          comment,
          source: 'INSTAGRAM',
          sourceDetail: conv.username ? `@${conv.username}` : null,
          repeatOfId,
        },
        select: { id: true, fullName: true, phone: true },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { applicationId: app.id } });
      return app;
    });
    if (!created) return;
    this.logger.log(`ИИ создал заявку ${created.id} из чата ${conversationId}`);
    this.activity
      .log({
        actorId: null,
        actorName: 'ИИ-помощник',
        actorRole: 'AI',
        action: 'CONVERSATION_LINK',
        studentName: created.fullName,
        details: `ИИ создал заявку из чата Instagram: ${created.fullName}, ${created.phone} — ${DIRECTION_LABEL[direction]}`,
      })
      .catch(() => undefined);
    void this.meta.notifyAllStaff({
      type: 'APPLICATION_NEW',
      title: 'ИИ создал заявку из Instagram',
      message: `${created.fullName}, ${created.phone} — ${DIRECTION_LABEL[direction]}`,
      payload: { applicationId: created.id, conversationId },
    });
    this.realtime.emitAllStaff('application:new', { id: created.id });
    this.meta.touch(conversationId);
  }

  /** ИИ просит менеджера: отметка в чате и уведомление всем (один раз, пока не снимут). */
  private async handoff(conv: { id: string; title: string | null; username: string | null }, reason: string) {
    const res = await this.prisma.conversation.updateMany({
      where: { id: conv.id, aiHandoffAt: null },
      data: { aiHandoffAt: new Date(), aiHandoffReason: reason.slice(0, 300) },
    });
    if (res.count) {
      const who = conv.title ?? (conv.username ? `@${conv.username}` : 'Клиент');
      void this.meta.notifyAllStaff({ type: 'MESSAGE_INBOUND', title: 'Клиенту в Instagram нужен менеджер', message: `${who}: ${reason}`, payload: { conversationId: conv.id } });
    }
    this.meta.touch(conv.id);
  }
}
