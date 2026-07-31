import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApplicationStatus, Direction } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { ApplicationsService, ApplicationTab } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

/** ТЗ 3.1 — фильтр по датам: копия подхода activity.controller.ts (from/to как ISO-строки, верхнюю границу нормализует фронт). */
function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// 2.2 аудита волны 2: RolesGuard навешен ПОМЕТОДНО (не на класс), как и был
// JwtAuthGuard раньше — POST /applications/public должен остаться доступен
// анониму с лендинга без авторизации вообще. @Roles-декораторы намеренно не
// добавлены: ApplicationsService уже проверяет права внутри (isPrivileged/
// canAccessStudentRecord — EMPLOYEE видит и редактирует только назначенные
// ему заявки), RolesGuard здесь просто активирует механизм @Roles на будущее.
@Controller('applications')
export class ApplicationsController {
  constructor(private apps: ApplicationsService) {}

  // Лимит: 5 заявок в минуту с одного IP — защита от спама из формы лендинга.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public')
  createFromLanding(@Body() dto: CreateApplicationDto) {
    return this.apps.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  list(
    @CurrentUser() user: any,
    @Query('status') status?: ApplicationStatus,
    @Query('direction') direction?: Direction,
    @Query('search') search?: string,
    @Query('mine') mine?: string,
    @Query('manager') manager?: string,
    @Query('tab') tab?: ApplicationTab,
    @Query('source') source?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('repeat') repeat?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.apps.findAll({
      status,
      direction,
      search,
      mine: mine === 'true',
      managerUserId: manager || undefined,
      currentUserId: user?.id,
      currentUserRole: user?.role,
      tab,
      source,
      from: parseDateParam(from),
      to: parseDateParam(to),
      repeat: repeat === 'true',
      page: parsePage(page),
      pageSize: parsePageSize(pageSize),
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('stats')
  stats(@CurrentUser() user: any) {
    return this.apps.stats(user);
  }

  // ТЗ 3.1 — счётчики вкладок «Все» / «Новые» / «В работе» / «Архив» с учётом
  // всех текущих фильтров кроме tab. Тот же набор query-параметров, что и list().
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('tab-counts')
  tabCounts(
    @CurrentUser() user: any,
    @Query('status') status?: ApplicationStatus,
    @Query('direction') direction?: Direction,
    @Query('search') search?: string,
    @Query('mine') mine?: string,
    @Query('manager') manager?: string,
    @Query('source') source?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('repeat') repeat?: string,
  ) {
    return this.apps.tabCounts({
      status,
      direction,
      search,
      mine: mine === 'true',
      managerUserId: manager || undefined,
      currentUserId: user?.id,
      currentUserRole: user?.role,
      source,
      from: parseDateParam(from),
      to: parseDateParam(to),
      repeat: repeat === 'true',
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.apps.findOne(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/history')
  history(@Param('id') id: string, @CurrentUser() user: any) {
    return this.apps.history(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() user: any,
  ) {
    return this.apps.update(id, dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id/manager')
  assignManager(
    @Param('id') id: string,
    @Body() body: { managerId?: string | null; chinaManagerId?: string | null },
    @CurrentUser() user: any,
  ) {
    return this.apps.assignManager(id, body, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/archive')
  archive(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: any) {
    return this.apps.archive(id, body?.reason, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/unarchive')
  unarchive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.apps.unarchive(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/clear-repeat')
  clearRepeat(@Param('id') id: string, @CurrentUser() user: any) {
    return this.apps.clearRepeat(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.apps.remove(id, user);
  }
}
