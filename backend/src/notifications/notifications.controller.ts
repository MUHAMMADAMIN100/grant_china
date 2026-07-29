import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: { sub: string; role: Role }, @Query('unread') unread?: string) {
    // Проблема 3 аудита волны 1: роль нужна listForUser(), чтобы отфильтровать
    // легаси-уведомления про чужих студентов для EMPLOYEE (FOUNDER/ADMIN видят всё).
    return this.notifications.listForUser(user.sub, user.role, unread === 'true');
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: { sub: string; role: Role }) {
    // Роль нужна по той же причине, что и в list(): счётчик обязан совпадать
    // со списком, иначе бейдж показывает число скрытых уведомлений.
    return this.notifications.unreadCount(user.sub, user.role);
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
