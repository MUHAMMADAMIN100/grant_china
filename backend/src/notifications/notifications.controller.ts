import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Region, Role } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// 2.2 аудита волны 2: раньше был только JwtAuthGuard. @Roles-декораторы не
// нужны — все методы строго user-scoped (свои уведомления сотрудника,
// user.sub из токена), это доступно любой роли. RolesGuard добавлен для
// единообразия механизма по всем контроллерам, не меняет поведение эндпоинтов.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: { sub: string; role: Role; region?: Region }, @Query('unread') unread?: string) {
    // Проблема 3 аудита волны 1: роль нужна listForUser(), чтобы отфильтровать
    // легаси-уведомления про чужих студентов для EMPLOYEE (FOUNDER/ADMIN видят всё).
    return this.notifications.listForUser(user.sub, user.role, unread === 'true', user.region);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: { sub: string; role: Role; region?: Region }) {
    // Роль нужна по той же причине, что и в list(): счётчик обязан совпадать
    // со списком, иначе бейдж показывает число скрытых уведомлений.
    return this.notifications.unreadCount(user.sub, user.role, user.region);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: { sub: string }, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: { sub: string }) {
    return this.notifications.markAllRead(user.sub);
  }
}
