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
 * УТВЕРЖДЕНИЕ — FOUNDER+ADMIN, но анти-самоутверждение и запрет ADMIN
 * утверждать листы ADMIN проверяются В СЕРВИСЕ (payslips.service.approve),
 * не только ролью.
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

  @Post('payslips/generate')
  @Roles(Role.FOUNDER, Role.ADMIN)
  generate(@Body() dto: GeneratePayslipsDto, @CurrentUser() user: any) {
    return this.payslips.generate(dto.period, user);
  }

  @Post('payslips/create')
  @Roles(Role.FOUNDER)
  createManual(@Body() dto: CreatePayslipDto, @CurrentUser() user: any) {
    return this.payslips.createManual(dto.userId, dto.period, user);
  }

  @Post('payslips/:id/recalculate')
  @Roles(Role.FOUNDER, Role.ADMIN)
  recalculate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payslips.recalculate(id, user);
  }

  @Patch('payslips/:id')
  @Roles(Role.FOUNDER)
  update(@Param('id') id: string, @Body() dto: UpdatePayslipDto, @CurrentUser() user: any) {
    return this.payslips.update(id, dto, user);
  }

  @Post('payslips/:id/approve')
  @Roles(Role.FOUNDER, Role.ADMIN)
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
