import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PayslipStatus, Role } from '@prisma/client';
import { PayslipsService } from './payslips.service';
import { periodKeyFor } from './period';
import {
  ApprovePayslipDto,
  CreatePayslipDto,
  GeneratePayslipsDto,
  PayPayslipDto,
  RecallPayslipDto,
  UpdatePayslipDto,
  VoidPayslipDto,
} from './dto/payslip.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

/**
 * Раздел 5 ТЗ (волна 6) — сводная ведомость, утверждение начислений,
 * фиксация выплат (ТЗ 5.2). @Roles на классе — БАЗОВАЯ линия защиты
 * (RolesGuard берёт метаданные класса, если на методе их нет), но на каждом
 * методе роль указана явно — намерение должно читаться в точке объявления
 * (см. accessModel проекта архитектора).
 *
 * ФИКСАЦИЯ ВЫПЛАТЫ — ТОЛЬКО FOUNDER (ТЗ 1.1: деньги подтверждает Основатель).
 *
 * ТЗ v3 раздел 4 (критерий приёмки №4): ВСЕ операции записи — генерация,
 * пересчёт, утверждение — сузились до FOUNDER. Администратору осталось
 * только чтение (@Roles(FOUNDER, ADMIN) на GET-методах): по таблице ролей он
 * «видит финансовую аналитику и платежи, но не может ничего изменять».
 *
 * Классовый @Roles(FOUNDER, ADMIN) оставлен как БАЗОВАЯ линия для GET'ов;
 * методы записи перекрывают его собственным @Roles(FOUNDER).
 *
 * Следствие: проверка `actor.role === ADMIN` внутри payslips.service.approve
 * стала недостижимой — ADMIN до сервиса больше не доходит. Она намеренно
 * оставлена на месте: это защита в глубину на случай, если классовый @Roles
 * однажды расширят, а про сервис забудут.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.FOUNDER, Role.ADMIN)
@Controller('payroll')
export class PayrollAdminController {
  constructor(private payslips: PayslipsService) {}

  @Get('summary')
  @Roles(Role.FOUNDER, Role.ADMIN)
  summary(@Query('period') period?: string) {
    return this.payslips.summary(period || periodKeyFor(new Date()));
  }

  @Get('kpi')
  @Roles(Role.FOUNDER, Role.ADMIN)
  kpi(@Query('period') period?: string, @Query('managerId') managerId?: string) {
    return this.payslips.kpiForAdmin(period || periodKeyFor(new Date()), managerId);
  }

  @Get('payslips')
  @Roles(Role.FOUNDER, Role.ADMIN)
  list(
    @Query('period') period?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: PayslipStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.payslips.findAllForAdmin({ period, userId, status, page: parsePage(page), pageSize: parsePageSize(pageSize) });
  }

  @Get('payslips/:id')
  @Roles(Role.FOUNDER, Role.ADMIN)
  one(@Param('id') id: string) {
    return this.payslips.findOneForAdmin(id);
  }

  // ТЗ v3 раздел 4: зарплата — часть финансового контура, Администратор в нём
  // только смотрит. GET-методы выше остаются ему доступны («видит финансовую
  // аналитику»), а генерация, пересчёт и утверждение начислений — нет.
  @Post('payslips/generate')
  @Roles(Role.FOUNDER)
  generate(@Body() dto: GeneratePayslipsDto, @CurrentUser() user: any) {
    return this.payslips.generate(dto.period, user);
  }

  @Post('payslips/create')
  @Roles(Role.FOUNDER)
  createManual(@Body() dto: CreatePayslipDto, @CurrentUser() user: any) {
    return this.payslips.createManual(dto.userId, dto.period, user);
  }

  @Post('payslips/:id/recalculate')
  @Roles(Role.FOUNDER)
  recalculate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payslips.recalculate(id, user);
  }

  @Patch('payslips/:id')
  @Roles(Role.FOUNDER)
  update(@Param('id') id: string, @Body() dto: UpdatePayslipDto, @CurrentUser() user: any) {
    return this.payslips.update(id, dto, user);
  }

  @Post('payslips/:id/approve')
  @Roles(Role.FOUNDER)
  approve(@Param('id') id: string, @Body() dto: ApprovePayslipDto, @CurrentUser() user: any) {
    return this.payslips.approve(id, dto, user);
  }

  @Post('payslips/:id/recall')
  @Roles(Role.FOUNDER)
  recall(@Param('id') id: string, @Body() dto: RecallPayslipDto, @CurrentUser() user: any) {
    return this.payslips.recall(id, dto, user);
  }

  @Post('payslips/:id/pay')
  @Roles(Role.FOUNDER)
  pay(@Param('id') id: string, @Body() dto: PayPayslipDto, @CurrentUser() user: any) {
    return this.payslips.pay(id, dto, user);
  }

  @Post('payslips/:id/void')
  @Roles(Role.FOUNDER)
  voidPayslip(@Param('id') id: string, @Body() dto: VoidPayslipDto, @CurrentUser() user: any) {
    return this.payslips.voidPayslip(id, dto, user);
  }

  @Post('payslips/:id/reissue')
  @Roles(Role.FOUNDER)
  reissue(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payslips.reissue(id, user);
  }

  @Delete('payslips/:id')
  @Roles(Role.FOUNDER)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payslips.remove(id, user);
  }
}
