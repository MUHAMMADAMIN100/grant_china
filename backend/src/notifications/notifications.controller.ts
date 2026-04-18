import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: { sub: string }, @Query('unread') unread?: string) {
    return this.notifications.listForUser(user.sub, unread === 'true');
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: { sub: string }) {
    return this.notifications.unreadCount(user.sub);
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
