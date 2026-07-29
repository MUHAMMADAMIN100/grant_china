import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Direction, Prisma, Program, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TelegramService } from '../telegram/telegram.service';
import { isPrivileged } from '../common/roles';
import { FileResolverService } from '../files/file-resolver.service';

type CurrentUser = { id: string; role: Role };

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
    minCost?: number;
    maxCost?: number;
    search?: string;
    publishedOnly?: boolean;
  }) {
    // Soft-delete: всегда исключаем удалённые программы
    const where: Prisma.ProgramWhereInput = { deletedAt: null };
    if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };
    if (filters.major) where.major = { contains: filters.major, mode: 'insensitive' };
    if (filters.direction) where.direction = filters.direction;
    if (typeof filters.minCost === 'number' || typeof filters.maxCost === 'number') {
      where.cost = {};
      if (typeof filters.minCost === 'number') (where.cost as any).gte = filters.minCost;
      if (typeof filters.maxCost === 'number') (where.cost as any).lte = filters.maxCost;
    }
    if (filters.publishedOnly) where.published = true;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { university: { contains: filters.search, mode: 'insensitive' } },
        { major: { contains: filters.search, mode: 'insensitive' } },
        { city: { contains: filters.search, mode: 'insensitive' } },
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
    const program = await this.prisma.program.create({
      data: {
        name: dto.name.trim(),
        university: dto.university.trim(),
        city: dto.city.trim(),
        major: dto.major.trim(),
        direction: dto.direction,
        cost: dto.cost,
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

  private buildCaption(program: Program, header = '🎓 *Новая программа в GrantChina*'): string {
    return (
      `${header}\n\n` +
      `📚 *${this.escape(program.name)}*\n` +
      `🏛 ${this.escape(program.university)}\n` +
      `📍 ${this.escape(program.city)}\n` +
      `🎯 ${this.escape(program.major)} · ${DIRECTION_LABEL[program.direction]}\n` +
      (program.duration ? `⏱ ${this.escape(program.duration)}\n` : '') +
      (program.language ? `🌐 ${this.escape(program.language)}\n` : '') +
      `\n💰 Стоимость: *${program.cost.toLocaleString('ru-RU')} ${program.currency}* / год\n` +
      (program.description ? `\n${this.escape(program.description.slice(0, 600))}` : '')
    );
  }

  private buildPhotoUrl(program: Program): string | null {
    if (!program.imageUrl) return null;
    if (program.imageUrl.startsWith('http')) return program.imageUrl;
    const publicBase = this.config.get<string>('PUBLIC_API_BASE');
    return publicBase ? `${publicBase}${program.imageUrl}` : null;
  }

  private async notifyChannelNew(program: Program) {
    if (!program.published) return;
    const caption = this.buildCaption(program);
    const photoUrl = this.buildPhotoUrl(program);

    let messageId: number | null = null;
    let hasPhoto = false;

    if (photoUrl) {
      const res = await this.telegram.sendPhotoToChannel(photoUrl, caption);
      if (res) {
        messageId = res.messageId;
        hasPhoto = res.hasPhoto;
      }
    } else {
      messageId = await this.telegram.sendToChannel(caption);
      hasPhoto = false;
    }

    if (messageId) {
      await this.prisma.program.update({
        where: { id: program.id },
        data: { telegramMessageId: messageId, telegramHasPhoto: hasPhoto },
      });
    }
  }

  private async notifyChannelUpdate(program: Program, imageChanged: boolean) {
    if (!program.telegramMessageId) return;
    const caption = this.buildCaption(program, '🎓 *Программа GrantChina*');
    const photoUrl = this.buildPhotoUrl(program);

    // Если картинка не менялась — просто обновляем подпись/текст и выходим.
    // editMessageMedia с тем же URL Telegram ругает "message is not modified".
    if (!imageChanged) {
      if (program.telegramHasPhoto) {
        await this.telegram.editChannelCaption(program.telegramMessageId, caption);
      } else {
        await this.telegram.editChannelText(program.telegramMessageId, caption);
      }
      return;
    }

    // Картинка поменялась. Самый надёжный путь — удалить старое сообщение и
    // отправить новое (Telegram editMessageMedia плохо работает с разной
    // топологией: текст<->фото, подмена URL, etc.). Сохраняем новый messageId.
    await this.repostChannel(program, caption, photoUrl);
  }

  private async repostChannel(program: Program, caption: string, photoUrl: string | null) {
    if (!program.telegramMessageId) return;
    await this.telegram.deleteChannelMessage(program.telegramMessageId);

    let newId: number | null = null;
    let hasPhoto = false;
    if (photoUrl) {
      const res = await this.telegram.sendPhotoToChannel(photoUrl, caption);
      if (res) {
        newId = res.messageId;
        hasPhoto = res.hasPhoto;
      }
    } else {
      newId = await this.telegram.sendToChannel(caption);
      hasPhoto = false;
    }

    if (newId) {
      await this.prisma.program.update({
        where: { id: program.id },
        data: { telegramMessageId: newId, telegramHasPhoto: hasPhoto },
      });
    }
  }

  private async notifyChannelDelete(program: Program) {
    if (!program.telegramMessageId) return;
    const ok = await this.telegram.deleteChannelMessage(program.telegramMessageId);
    if (ok) return;
    // Не получилось удалить (старше 48 часов / нет прав) — помечаем пост
    const cancelled =
      `~${this.escape(program.name)}~\n\n❌ *Программа снята с публикации*`;
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
