import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Direction, Prisma, Program, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { containsInsensitive } from '../common/search';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TelegramService } from '../telegram/telegram.service';
import { isPrivileged } from '../common/roles';
import { FileResolverService } from '../files/file-resolver.service';
import { CostPeriod, assertPrices, formatPrice, priceRangeWhere } from './program-price';

type CurrentUser = { id: string; role: Role };

/** Пределы Telegram: подпись под фото — 1024 знака, текстовое сообщение — 4096. */
const CAPTION_LIMIT = 1024;
const TEXT_LIMIT = 4096;
const NEW_HEADER = '🎓 *Новая программа в GrantChina*';
const UPDATED_HEADER = '🎓 *Программа GrantChina*';

/**
 * Сколько знаков насчитает Telegram: разметка Markdown (`*`, `_`, `` ` ``) и
 * экранирующие `\` в подсчёт не входят, считаются UTF-16-единицы — как длина
 * строки в JS (эмодзи — две).
 */
export function telegramLength(markdown: string): number {
  let n = 0;
  for (let i = 0; i < markdown.length; i++) {
    const ch = markdown[i];
    if (ch === '\\' && i + 1 < markdown.length) {
      n += 1;
      i += 1;
      continue;
    }
    if (ch === '*' || ch === '_' || ch === '`') continue;
    n += 1;
  }
  return n;
}

const DIRECTION_LABEL: Record<Direction, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
  LANGUAGE_COLLEGE: 'Языковой + колледж',
  LANGUAGE_BACHELOR: 'Языковой + бакалавриат',
  COLLEGE: 'Колледж',
};

@Injectable()
export class ProgramsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private telegram: TelegramService,
    private config: ConfigService,
    private files: FileResolverService,
  ) {}

  async findAll(filters: {
    city?: string;
    major?: string;
    direction?: Direction;
    minCost?: string | number;
    maxCost?: string | number;
    costPeriod?: CostPeriod;
    search?: string;
    publishedOnly?: boolean;
  }) {
    // Soft-delete: всегда исключаем удалённые программы
    const where: Prisma.ProgramWhereInput = {
      deletedAt: null,
      // «Цена от — до» — по цене за год или за семестр (costPeriod).
      ...priceRangeWhere(filters.minCost, filters.maxCost, filters.costPeriod),
    };
    if (filters.city) where.city = containsInsensitive(filters.city);
    if (filters.major) where.major = containsInsensitive(filters.major);
    if (filters.direction) where.direction = filters.direction;
    if (filters.publishedOnly) where.published = true;
    if (filters.search) {
      where.OR = [
        { name: containsInsensitive(filters.search) },
        { university: containsInsensitive(filters.search) },
        { major: containsInsensitive(filters.search) },
        { city: containsInsensitive(filters.search) },
      ];
    }
    return this.prisma.program.findMany({
      where,
      orderBy: [{ published: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * `publishedOnly` — используется публичным `GET /programs/public/:id`
   * (без авторизации), чтобы неопубликованные черновики с внутренними
   * ценами не были доступны анониму по прямой ссылке на id.
   */
  async findOne(id: string, publishedOnly = false) {
    // Soft-delete: удалённая программа скрыта от API.
    const where: Prisma.ProgramWhereInput = { id, deletedAt: null };
    if (publishedOnly) where.published = true;
    const p = await this.prisma.program.findFirst({ where });
    if (!p) throw new NotFoundException('Программа не найдена');
    return p;
  }

  async create(dto: CreateProgramDto, user: CurrentUser) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может создавать программы');
    }
    assertPrices(dto.cost, dto.semesterCost);
    const program = await this.prisma.program.create({
      data: {
        name: dto.name.trim(),
        university: dto.university.trim(),
        city: dto.city.trim(),
        major: dto.major.trim(),
        direction: dto.direction,
        cost: dto.cost ?? null,
        semesterCost: dto.semesterCost ?? null,
        currency: dto.currency || 'CNY',
        duration: dto.duration || null,
        language: dto.language || null,
        description: dto.description || null,
        imageUrl: dto.imageUrl || null,
        published: dto.published ?? true,
      },
    });

    // Проблема B аудита: раньше сюда летела вся `program` (в т.ч. черновики
    // с published:false и внутренней ценой) — Programs.tsx/ProgramsSection.tsx
    // на любое program:* просто перезапрашивают список по HTTP (у студента —
    // только published:true, см. programs.service.findAll publishedOnly).
    this.realtime.emitAllStaff('program:new', { id: program.id });
    if (program.published) {
      this.realtime.emitAllStudents('program:new', { id: program.id });
    }

    // Картинка программы теперь публично раздаётся files/uploads — сбрасываем
    // TTL-кэш публичных имён, иначе анониму на лендинге до 60с будет 404.
    this.files.invalidatePublicCache();

    // Шлём в канал и сохраняем message_id для последующего edit/delete
    this.notifyChannelNew(program).catch(() => undefined);

    return program;
  }

  async update(id: string, dto: UpdateProgramDto, user: CurrentUser) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может редактировать программы');
    }
    const existing = await this.findOne(id);
    // null в dto — «цену убрали», undefined — «не трогали». После правки
    // должна остаться хотя бы одна из двух цен.
    assertPrices(
      dto.cost !== undefined ? dto.cost : existing.cost,
      dto.semesterCost !== undefined ? dto.semesterCost : existing.semesterCost,
    );
    const updated = await this.prisma.program.update({ where: { id }, data: dto });

    this.realtime.emitAllStaff('program:updated', { id: updated.id });
    if (updated.published) {
      this.realtime.emitAllStudents('program:updated', { id: updated.id });
    }

    // Картинка могла смениться (или программу опубликовали/сняли с публикации) —
    // сбрасываем TTL-кэш публичных имён files/uploads.
    this.files.invalidatePublicCache();

    // Если у программы был пост в канале — обновляем его
    if (existing.telegramMessageId) {
      const imageChanged = existing.imageUrl !== updated.imageUrl;
      this.notifyChannelUpdate(updated, imageChanged).catch(() => undefined);
    } else if (updated.published) {
      // Если поста ещё не было (например, программа была не published) — создаём сейчас
      this.notifyChannelNew(updated).catch(() => undefined);
    }

    return updated;
  }

  async remove(id: string, user: CurrentUser) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может удалять программы');
    }
    const existing = await this.findOne(id);

    // Сначала пытаемся удалить пост в канале (пока запись ещё есть, есть message_id)
    if (existing.telegramMessageId) {
      await this.notifyChannelDelete(existing).catch(() => undefined);
    }

    // Soft delete: помечаем deletedAt, физически программу не удаляем.
    await this.prisma.program.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // Картинка удалённой программы больше не должна отдаваться анониму.
    this.files.invalidatePublicCache();

    this.realtime.emitAllStaff('program:deleted', { id });
    this.realtime.emitAllStudents('program:deleted', { id });

    return { ok: true };
  }

  async filters() {
    const [cities, majors] = await Promise.all([
      this.prisma.program.findMany({
        where: { published: true, deletedAt: null },
        select: { city: true },
        distinct: ['city'],
        orderBy: { city: 'asc' },
      }),
      this.prisma.program.findMany({
        where: { published: true, deletedAt: null },
        select: { major: true },
        distinct: ['major'],
        orderBy: { major: 'asc' },
      }),
    ]);
    return {
      cities: cities.map((c) => c.city),
      majors: majors.map((m) => m.major),
    };
  }

  /** Карточка программы без описания: заголовок, вуз, город, стоимость. */
  private buildCard(program: Program, header: string): string {
    const head =
      `${header}\n\n` +
      `📚 *${this.escape(program.name)}*\n` +
      `🏛 ${this.escape(program.university)}\n` +
      `📍 ${this.escape(program.city)}\n` +
      `🎯 ${this.escape(program.major)} · ${DIRECTION_LABEL[program.direction]}\n` +
      (program.duration ? `⏱ ${this.escape(program.duration)}\n` : '') +
      (program.language ? `🌐 ${this.escape(program.language)}\n` : '');
    const prices = this.buildPrices(program);
    return prices ? `${head}\n💰 Стоимость: ${prices}` : head.trimEnd();
  }

  /**
   * «*16 200 CNY* / год · *8 100 CNY* / семестр» — только указанные цены
   * (04.11.2026: появилась цена за семестр, цена за год стала необязательной).
   * Валюта (CNY/USD/RUB/TJS) символов разметки не содержит, экранировать нечего.
   */
  private buildPrices(program: Program): string {
    const parts: string[] = [];
    if (program.cost != null) parts.push(`*${formatPrice(program.cost, program.currency)}* / год`);
    if (program.semesterCost != null) parts.push(`*${formatPrice(program.semesterCost, program.currency)}* / семестр`);
    return parts.join(' · ');
  }

  /**
   * Пост программы в канале: `first` — фото с подписью (или текст, если фото нет),
   * `second` — полное описание отдельным сообщением, когда оно не влезает в первое.
   *
   * 04.11.2026: раньше описание просто обрезалось до 600 знаков, чтобы подпись
   * под фото не превысила лимит Telegram (1024), — и клиенты видели пост,
   * оборванный на полуслове («Загранпаспорт и фотог»). Теперь текст не теряется.
   */
  private buildPost(program: Program, asPhoto: boolean, header: string): { first: string; second: string | null } {
    const card = this.buildCard(program, header);
    const description = program.description?.trim();
    if (!description) return { first: card, second: null };
    const full = `${card}\n\n${this.escape(description)}`;
    const limit = asPhoto ? CAPTION_LIMIT : TEXT_LIMIT;
    if (telegramLength(full) <= limit) return { first: full, second: null };
    return { first: card, second: this.escape(description) };
  }

  private buildPhotoUrl(program: Program): string | null {
    if (!program.imageUrl) return null;
    if (program.imageUrl.startsWith('http')) return program.imageUrl;
    const publicBase = this.config.get<string>('PUBLIC_API_BASE');
    return publicBase ? `${publicBase}${program.imageUrl}` : null;
  }

  /**
   * Опубликовать пост программы: фото с подписью (или текст) и, если описание
   * не влезло, полное описание вторым сообщением сразу под ним. Id обоих
   * сообщений сохраняются, чтобы потом править и снимать их вместе.
   */
  private async publishPost(program: Program, header: string) {
    const photoUrl = this.buildPhotoUrl(program);
    const post = this.buildPost(program, !!photoUrl, header);

    let messageId: number | null = null;
    let hasPhoto = false;
    if (photoUrl) {
      const res = await this.telegram.sendPhotoToChannel(photoUrl, post.first);
      if (res) {
        messageId = res.messageId;
        hasPhoto = res.hasPhoto;
      }
    } else {
      messageId = await this.telegram.sendToChannel(post.first);
    }

    const textId = messageId && post.second ? await this.telegram.sendToChannel(post.second) : null;
    // Не ушло — id обнуляем: следующее сохранение программы опубликует пост заново.
    await this.prisma.program.update({
      where: { id: program.id },
      data: { telegramMessageId: messageId, telegramHasPhoto: hasPhoto, telegramTextMessageId: textId },
    });
  }

  private async notifyChannelNew(program: Program) {
    if (!program.published) return;
    await this.publishPost(program, NEW_HEADER);
  }

  private async notifyChannelUpdate(program: Program, imageChanged: boolean) {
    if (!program.telegramMessageId) return;
    // Лимит считаем по тому, чем первое сообщение уже является: подпись под фото или текст.
    const post = this.buildPost(program, program.telegramHasPhoto, UPDATED_HEADER);
    const layoutChanged = !!program.telegramTextMessageId !== !!post.second;

    // Картинка поменялась или пост надо разбить на два / собрать в один —
    // надёжнее пересоздать (editMessageMedia плохо переносит смену фото↔текст).
    if (imageChanged || layoutChanged) {
      if (await this.repostChannel(program, UPDATED_HEADER, imageChanged)) return;
    }

    // Иначе правим на месте. editMessageMedia с тем же URL Telegram ругает
    // «message is not modified», поэтому меняем только подпись/текст.
    if (program.telegramHasPhoto) {
      await this.telegram.editChannelCaption(program.telegramMessageId, post.first);
    } else {
      await this.telegram.editChannelText(program.telegramMessageId, post.first);
    }
    await this.syncDescriptionMessage(program, post.second);
  }

  /** Второе сообщение (полное описание): поправить, дослать или убрать. */
  private async syncDescriptionMessage(program: Program, second: string | null) {
    const id = program.telegramTextMessageId;
    if (second) {
      if (id) {
        await this.telegram.editChannelText(id, second);
        return;
      }
      const newId = await this.telegram.sendToChannel(second);
      if (newId) await this.prisma.program.update({ where: { id: program.id }, data: { telegramTextMessageId: newId } });
      return;
    }
    if (!id) return;
    if (!(await this.telegram.deleteChannelMessage(id))) {
      await this.telegram.editChannelText(id, '⬆️ Описание программы — в посте выше.');
    }
    await this.prisma.program.update({ where: { id: program.id }, data: { telegramTextMessageId: null } });
  }

  /**
   * Удалить старый пост и опубликовать заново. Telegram не даёт удалять
   * сообщения старше 48 часов — тогда false: смена картинки всё равно
   * публикует новый пост (как раньше), а смену разбивки вызывающий делает
   * правкой на месте, без дубля в канале.
   */
  private async repostChannel(program: Program, header: string, imageChanged: boolean): Promise<boolean> {
    if (!program.telegramMessageId) return false;
    const deleted = await this.telegram.deleteChannelMessage(program.telegramMessageId);
    if (!deleted && !imageChanged) return false;
    if (program.telegramTextMessageId && !(await this.telegram.deleteChannelMessage(program.telegramTextMessageId))) {
      await this.telegram.editChannelText(program.telegramTextMessageId, '⬇️ Программа обновлена — актуальный пост ниже.');
    }
    await this.publishPost(program, header);
    return true;
  }

  private async notifyChannelDelete(program: Program) {
    if (!program.telegramMessageId) return;
    // Не получилось удалить (старше 48 часов / нет прав) — помечаем пост
    const cancelled = `~${this.escape(program.name)}~\n\n❌ *Программа снята с публикации*`;
    if (program.telegramTextMessageId && !(await this.telegram.deleteChannelMessage(program.telegramTextMessageId))) {
      await this.telegram.editChannelText(program.telegramTextMessageId, cancelled);
    }
    const ok = await this.telegram.deleteChannelMessage(program.telegramMessageId);
    if (ok) return;
    if (program.telegramHasPhoto) {
      await this.telegram.editChannelCaption(program.telegramMessageId, cancelled);
    } else {
      await this.telegram.editChannelText(program.telegramMessageId, cancelled);
    }
  }

  private escape(s: string): string {
    // Экранируем Markdown-символы, ломающие parse_mode=Markdown
    return s.replace(/([_*[\]`])/g, '\\$1');
  }
}
