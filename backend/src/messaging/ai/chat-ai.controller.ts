import { Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ChatAiService } from './chat-ai.service';

export class AiSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(30000) notes?: string;
}

export class AiTestMessageDto {
  @IsIn(['client', 'ai']) from!: 'client' | 'ai';
  @IsString() @MaxLength(2000) text!: string;
}

export class AiTestDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => AiTestMessageDto) messages!: AiTestMessageDto[];
  @IsOptional() @IsString() @MaxLength(30000) notes?: string;
}

export class QuickReplyDto {
  @IsString() @MinLength(1) @MaxLength(40) title!: string;
  @IsString() @MinLength(1) @MaxLength(2000) text!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class QuickReplyUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) text?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

/**
 * 21.11.2026 — настройки ИИ-помощника в Instagram. Читать состояние может
 * каждый сотрудник (в чате видно, отвечает ли ИИ), менять и проверять —
 * руководство.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('messaging/ai')
export class ChatAiController {
  constructor(private ai: ChatAiService) {}

  @Get('settings')
  settings() {
    return this.ai.publicSettings();
  }

  @Roles(Role.FOUNDER, Role.ADMIN)
  @Put('settings')
  save(@Body() dto: AiSettingsDto, @CurrentUser() user: any) {
    return this.ai.saveSettings(dto, user);
  }

  /** Каждый запрос — платный вызов Gemini: не чаще 20 в минуту. */
  @Roles(Role.FOUNDER, Role.ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('test')
  test(@Body() dto: AiTestDto) {
    return this.ai.test(dto);
  }
}

/** 21.11.2026 — быстрые ответы («/» в поле ответа). Удаление — только отметкой deletedAt. */
@Injectable()
export class QuickRepliesService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  list() {
    return this.prisma.chatQuickReply.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, text: true, sortOrder: true, updatedAt: true },
    });
  }

  private changed() {
    this.realtime.emitAllStaff('quick-replies:updated', {});
  }

  async create(dto: QuickReplyDto, userId: string) {
    const max = await this.prisma.chatQuickReply.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
    const row = await this.prisma.chatQuickReply.create({
      data: { title: dto.title.trim().replace(/^\/+/, ''), text: dto.text.trim(), sortOrder: dto.sortOrder ?? (max._max.sortOrder ?? 0) + 1, createdById: userId },
      select: { id: true, title: true, text: true, sortOrder: true, updatedAt: true },
    });
    this.changed();
    return row;
  }

  async update(id: string, dto: QuickReplyUpdateDto) {
    const cur = await this.prisma.chatQuickReply.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!cur) throw new NotFoundException('Быстрый ответ не найден');
    const row = await this.prisma.chatQuickReply.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim().replace(/^\/+/, '') } : {}),
        ...(dto.text !== undefined ? { text: dto.text.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      select: { id: true, title: true, text: true, sortOrder: true, updatedAt: true },
    });
    this.changed();
    return row;
  }

  async remove(id: string) {
    const res = await this.prisma.chatQuickReply.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw new NotFoundException('Быстрый ответ не найден');
    this.changed();
    return { ok: true };
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('messaging/quick-replies')
export class QuickRepliesController {
  constructor(private replies: QuickRepliesService) {}

  @Get()
  list() {
    return this.replies.list();
  }

  @Roles(Role.FOUNDER, Role.ADMIN)
  @Post()
  create(@Body() dto: QuickReplyDto, @CurrentUser() user: any) {
    return this.replies.create(dto, user.id);
  }

  @Roles(Role.FOUNDER, Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: QuickReplyUpdateDto) {
    return this.replies.update(id, dto);
  }

  @Roles(Role.FOUNDER, Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.replies.remove(id);
  }
}
