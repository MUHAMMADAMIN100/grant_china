import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ActivityService, ActivityAction } from './activity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private activity: ActivityService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('actorId') actorId?: string,
    @Query('studentId') studentId?: string,
    @Query('action') action?: ActivityAction,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
  ) {
    return this.activity.list({
      actorId,
      studentId,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      take: take ? Number(take) : undefined,
      currentUserId: user?.id,
      currentUserRole: user?.role,
    });
  }
}
