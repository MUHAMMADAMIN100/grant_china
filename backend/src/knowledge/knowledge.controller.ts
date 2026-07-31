import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';
import { CreateKnowledgeArticleDto, UpdateKnowledgeArticleDto } from './dto/knowledge-article.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { isPrivileged } from '../common/roles';
import { KNOWLEDGE_CATEGORIES } from './knowledge-categories';

/**
 * ТЗ 6.1 — база знаний. ЧИТАЮТ все сотрудники (в этом весь смысл: регламент
 * должен быть под рукой у менеджера), РЕДАКТИРУЮТ только FOUNDER и ADMIN —
 * инструкция, которую может переписать кто угодно, перестаёт быть инструкцией.
 *
 * Черновики (published = false) видны только редакторам: рядовой сотрудник не
 * должен принять неутверждённый регламент за действующий.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private knowledge: KnowledgeService) {}

  @Get('categories')
  categories() {
    return { items: KNOWLEDGE_CATEGORIES };
  }

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('drafts') drafts?: string,
  ) {
    // Черновики отдаём, только если их ЯВНО попросили И роль позволяет.
    const includeDrafts = drafts === 'true' && isPrivileged(user?.role);
    return this.knowledge.list({ category: category || undefined, search: search || undefined, includeDrafts });
  }

  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.knowledge.findOne(id, isPrivileged(user?.role));
  }

  @Post()
  @Roles(Role.FOUNDER, Role.ADMIN)
  create(@Body() dto: CreateKnowledgeArticleDto, @CurrentUser() user: any) {
    return this.knowledge.create(dto, user);
  }

  @Patch(':id')
  @Roles(Role.FOUNDER, Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateKnowledgeArticleDto, @CurrentUser() user: any) {
    return this.knowledge.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.FOUNDER, Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.knowledge.remove(id, user);
  }
}
