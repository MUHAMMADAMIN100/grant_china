import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { CreateKnowledgeArticleDto, UpdateKnowledgeArticleDto } from './dto/knowledge-article.dto';

export type CurrentUser = { id: string; role: Role };

const ARTICLE_INCLUDE = {
  createdBy: { select: { id: true, fullName: true } },
  updatedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.KnowledgeArticleInclude;

/**
 * Максимальный объём базы, уезжающий в системный промпт AI-помощника.
 * Ограничение вынужденное: контекст модели конечен, а стоимость запроса
 * линейна по числу входных токенов. ~60 000 символов ≈ 20–25 тысяч токенов —
 * с запасом влезает в окно и стоит копейки при включённом кэшировании
 * промпта. Если база перерастёт лимит, статьи сверх него НЕ отбрасываются
 * молча: buildContext() возвращает признак усечения, и ai.service явно
 * сообщает об этом в ответе (правило проекта — никаких тихих обрезаний).
 */
const MAX_CONTEXT_CHARS = 60_000;

@Injectable()
export class KnowledgeService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  // ------------------------------------------------------------------
  // Чтение
  // ------------------------------------------------------------------

  /**
   * Список статей. `includeDrafts` доступен только редакторам (FOUNDER/ADMIN,
   * проверяется в контроллере): рядовой сотрудник не должен видеть черновик
   * регламента и принять его за действующее правило.
   */
  async list(filters: { category?: string; search?: string; includeDrafts?: boolean }) {
    const and: Prisma.KnowledgeArticleWhereInput[] = [];
    if (!filters.includeDrafts) and.push({ published: true });
    if (filters.category) and.push({ category: filters.category });
    if (filters.search) {
      and.push({
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { body: { contains: filters.search, mode: 'insensitive' } },
          { tags: { has: filters.search.toLowerCase() } },
        ],
      });
    }
    const where: Prisma.KnowledgeArticleWhereInput = { deletedAt: null, ...(and.length ? { AND: and } : {}) };
    return this.prisma.knowledgeArticle.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: ARTICLE_INCLUDE,
    });
  }

  async findOne(id: string, includeDrafts: boolean) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id, deletedAt: null, ...(includeDrafts ? {} : { published: true }) },
      include: ARTICLE_INCLUDE,
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    return article;
  }

  /**
   * Собирает контекст для AI-помощника: все ОПУБЛИКОВАННЫЕ статьи в порядке
   * отображения. Черновики намеренно не участвуют — иначе помощник отвечал бы
   * по правилу, которое ещё не утверждено.
   *
   * Возвращает и признак усечения: если база не влезла целиком, помощник
   * обязан честно сказать об этом, а не сделать вид, что видел всё.
   */
  async buildContext(): Promise<{ text: string; articles: number; truncated: boolean }> {
    const articles = await this.prisma.knowledgeArticle.findMany({
      where: { deletedAt: null, published: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { title: true, category: true, tags: true, body: true },
    });

    const parts: string[] = [];
    let used = 0;
    let truncated = false;
    for (const a of articles) {
      const block =
        `### ${a.title}\n` +
        `Раздел: ${a.category}` +
        (a.tags.length ? ` | Ключевые слова: ${a.tags.join(', ')}` : '') +
        `\n${a.body}\n`;
      if (used + block.length > MAX_CONTEXT_CHARS) {
        truncated = true;
        break;
      }
      parts.push(block);
      used += block.length;
    }

    return { text: parts.join('\n---\n\n'), articles: parts.length, truncated };
  }

  // ------------------------------------------------------------------
  // Запись (только FOUNDER/ADMIN — проверяется @Roles в контроллере)
  // ------------------------------------------------------------------

  async create(dto: CreateKnowledgeArticleDto, user: CurrentUser) {
    const article = await this.prisma.knowledgeArticle.create({
      data: {
        title: dto.title.trim(),
        category: dto.category ?? 'GENERAL',
        body: dto.body.trim(),
        tags: (dto.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
        published: dto.published ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdById: user.id,
        updatedById: user.id,
      },
      include: ARTICLE_INCLUDE,
    });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'KNOWLEDGE_CREATE',
        details: `Создана статья базы знаний «${article.title}»`,
      })
      .catch(() => undefined);
    return article;
  }

  async update(id: string, dto: UpdateKnowledgeArticleDto, user: CurrentUser) {
    const existing = await this.prisma.knowledgeArticle.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Статья не найдена');

    // Unchecked-вариант: он допускает скалярный FK updatedById напрямую.
    // Обычный UpdateInput требует вложенного `updatedBy: { connect: ... }`,
    // что здесь только шум — связь уже есть, меняется лишь автор правки.
    const data: Prisma.KnowledgeArticleUncheckedUpdateInput = { updatedById: user.id };
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.body !== undefined) data.body = dto.body.trim();
    if (dto.tags !== undefined) data.tags = dto.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (dto.published !== undefined) data.published = dto.published;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    const article = await this.prisma.knowledgeArticle.update({ where: { id }, data, include: ARTICLE_INCLUDE });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'KNOWLEDGE_UPDATE',
        details:
          `Изменена статья базы знаний «${article.title}»` +
          (dto.published !== undefined ? (dto.published ? ' (опубликована)' : ' (снята с публикации)') : ''),
      })
      .catch(() => undefined);
    return article;
  }

  /** Soft-delete (правило проекта №1). */
  async remove(id: string, user: CurrentUser) {
    const existing = await this.prisma.knowledgeArticle.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Статья не найдена');
    await this.prisma.knowledgeArticle.update({ where: { id }, data: { deletedAt: new Date() } });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'KNOWLEDGE_DELETE',
        details: `Удалена статья базы знаний «${existing.title}»`,
      })
      .catch(() => undefined);
    return { ok: true };
  }
}
