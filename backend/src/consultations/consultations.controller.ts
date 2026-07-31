import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ConsultationKind, ConsultationOutcome } from '@prisma/client';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ТЗ 3.2 — «база данных консультаций и собеседований». RolesGuard навешен
// явно (не глобальный), но @Roles не используется нигде в этом контроллере:
// доступ и видимость целиком считает ConsultationsService (владелец записи
// либо FOUNDER/ADMIN) — тот же приём, что в applications.controller.ts/tasks.controller.ts.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('consultations')
export class ConsultationsController {
  constructor(private consultations: ConsultationsService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('managerId') managerId?: string,
    @Query('kind') kind?: ConsultationKind,
    @Query('outcome') outcome?: ConsultationOutcome,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('applicationId') applicationId?: string,
    @Query('studentId') studentId?: string,
    @Query('mine') mine?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.consultations.findAll(
      {
        from: parseDateParam(from),
        to: parseDateParam(to),
        managerId,
        kind,
        outcome,
        source,
        search,
        applicationId,
        studentId,
        mine: mine === 'true',
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  @Get('stats')
  stats(@CurrentUser() user: any) {
    return this.consultations.stats(user);
  }

  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultations.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateConsultationDto, @CurrentUser() user: any) {
    return this.consultations.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateConsultationDto, @CurrentUser() user: any) {
    return this.consultations.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultations.remove(id, user);
  }

  @Post(':id/convert')
  convert(@Param('id') id: string, @CurrentUser() user: any) {
    return this.consultations.convert(id, user);
  }
}
