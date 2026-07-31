import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

// ТЗ 6.3 — лента текстовых комментариев в карточке студента/заявки.
// RolesGuard навешен явно (не глобальный), @Roles не используется нигде:
// доступ целиком считает CommentsService (владелец студента/заявки либо
// FOUNDER/ADMIN на чтение, автор либо FOUNDER/ADMIN на правку/удаление) —
// тот же приём, что в consultations.controller.ts. В личном кабинете
// студента (frontend-landing) эндпоинтов комментариев НЕТ и не появляется —
// комментарий по умолчанию internal (см. schema.prisma CommentVisibility).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('comments')
export class CommentsController {
  constructor(private comments: CommentsService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('studentId') studentId?: string,
    @Query('applicationId') applicationId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.comments.list(
      { studentId, applicationId, page: parsePage(page), pageSize: parsePageSize(pageSize) },
      user,
    );
  }

  @Post()
  create(@Body() dto: CreateCommentDto, @CurrentUser() user: any) {
    return this.comments.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCommentDto, @CurrentUser() user: any) {
    return this.comments.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.comments.remove(id, user);
  }
}
