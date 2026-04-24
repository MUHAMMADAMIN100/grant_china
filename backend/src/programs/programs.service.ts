import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Direction, Prisma, Program, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TelegramService } from '../telegram/telegram.service';

type CurrentUser = { id: string; role: Role };

const DIRECTION_LABEL: Record<Direction, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
};

@Injectable()
export class ProgramsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private telegram: TelegramService,
    private config: ConfigService,
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
    const where: Prisma.ProgramWhereInput = {};
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

  async findOne(id: string) {
    const p = await this.prisma.program.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Программа не найдена');
    return p;
  }

  async create(dto: CreateProgramDto, user: CurrentUser) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Только администратор может создавать программы');
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

    this.realtime.emitStaff('program:new', { program });
    this.notifyChannelNew(program).catch(() => undefined);

    return program;
  }

  async update(id: string, dto: UpdateProgramDto, user: CurrentUser) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Только администратор может редактировать программы');
    }
    await this.findOne(id);
    const updated = await this.prisma.program.update({ where: { id }, data: dto });
    this.realtime.emitStaff('program:updated', { program: updated });
    return updated;
  }

  async remove(id: string, user: CurrentUser) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Только администратор может удалять программы');
    }
    await this.findOne(id);
    await this.prisma.program.delete({ where: { id } });
    this.realtime.emitStaff('program:deleted', { id });
    return { ok: true };
  }

  async filters() {
    const [cities, majors] = await Promise.all([
      this.prisma.program.findMany({
        where: { published: true },
        select: { city: true },
        distinct: ['city'],
        orderBy: { city: 'asc' },
      }),
      this.prisma.program.findMany({
        where: { published: true },
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

  private async notifyChannelNew(program: Program) {
    if (!program.published) return;
    const caption =
      `🎓 *Новая программа в GrantChina*\n\n` +
      `📚 *${this.escape(program.name)}*\n` +
      `🏛 ${this.escape(program.university)}\n` +
      `📍 ${this.escape(program.city)}\n` +
      `🎯 ${this.escape(program.major)} · ${DIRECTION_LABEL[program.direction]}\n` +
      (program.duration ? `⏱ ${this.escape(program.duration)}\n` : '') +
      (program.language ? `🌐 ${this.escape(program.language)}\n` : '') +
      `\n💰 Стоимость: *${program.cost.toLocaleString('ru-RU')} ${program.currency}* / год\n` +
      (program.description ? `\n${this.escape(program.description.slice(0, 600))}` : '');

    const publicBase = this.config.get<string>('PUBLIC_API_BASE');
    const photoUrl = program.imageUrl
      ? program.imageUrl.startsWith('http')
        ? program.imageUrl
        : publicBase
          ? `${publicBase}${program.imageUrl}`
          : null
      : null;

    if (photoUrl) {
      await this.telegram.sendPhotoToChannel(photoUrl, caption);
    } else {
      await this.telegram.sendToChannel(caption);
    }
  }

  private escape(s: string): string {
    // Экранируем Markdown-символы, ломающие parse_mode=Markdown
    return s.replace(/([_*[\]`])/g, '\\$1');
  }
}
