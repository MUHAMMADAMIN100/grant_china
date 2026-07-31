import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { GrantIntake, GrantStatus, Role } from '@prisma/client';
import { GrantsService } from './grants.service';
import { CreateGrantDto } from './dto/create-grant.dto';
import { UpdateGrantDto } from './dto/update-grant.dto';
import { AdvanceGrantDto } from './dto/advance-grant.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

function parseDueInDays(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Раздел 4 ТЗ — реестр студентов с «двойным грантом». RolesGuard навешен
// явно (не глобальный, см. auth/roles.guard.ts), но @Roles используется
// только на DELETE — доступ на чтение/запись отдельного гранта считает
// GrantsService (владелец студента либо FOUNDER/ADMIN), тот же приём, что
// в consultations.controller.ts/tasks.controller.ts.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('grants')
export class GrantsController {
  constructor(private grants: GrantsService) {}

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('multiOnly') multiOnly?: string,
    @Query('status') status?: GrantStatus,
    @Query('intake') intake?: GrantIntake,
    @Query('managerId') managerId?: string,
    @Query('studentId') studentId?: string,
    @Query('search') search?: string,
    @Query('dueInDays') dueInDays?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.grants.findAll(
      {
        multiOnly: multiOnly === undefined ? undefined : multiOnly !== 'false',
        status,
        intake,
        managerId,
        studentId,
        search,
        dueInDays: parseDueInDays(dueInDays),
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  @Get('stats')
  stats(@CurrentUser() user: any) {
    return this.grants.stats(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.grants.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateGrantDto, @CurrentUser() user: any) {
    return this.grants.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGrantDto, @CurrentUser() user: any) {
    return this.grants.update(id, dto, user);
  }

  @Post(':id/advance')
  advance(@Param('id') id: string, @Body() dto: AdvanceGrantDto, @CurrentUser() user: any) {
    return this.grants.advance(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.FOUNDER, Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.grants.remove(id, user);
  }
}
