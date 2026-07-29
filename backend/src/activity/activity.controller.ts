import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ActivityService, ActivityAction } from './activity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

/**
 * Раздел 2 ТЗ («СИСТЕМНЫЕ ЛОГИ» — доступны Основателю; операционный контроль
 * Администратора тоже требует видеть журнал). 2.2/2.7 аудита волны 2: раньше
 * тут стоял только JwtAuthGuard — RolesGuard не сработал бы, и ЛЮБОЙ EMPLOYEE
 * мог дёрнуть GET /activity напрямую по HTTP (фильтровался только *контент*
 * внутри ActivityService.list(), но не доступ к самому эндпоинту). Во фронте
 * страница /activity и так открыта только FOUNDER/ADMIN (frontend-crm/src/App.tsx,
 * ProtectedRoute roles=['FOUNDER','ADMIN']) — других потребителей этого
 * эндпоинта в проекте нет (единственный вызов activity.list() — отсюда).
 * Фильтрацию по EMPLOYEE внутри list() НЕ убираем (см. её же комментарий) —
 * это защита в глубину на случай будущего использования сервиса.
 */
@Controller('activity')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivityController {
  constructor(private activity: ActivityService) {}

  @Get()
  @Roles(Role.FOUNDER, Role.ADMIN)
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
