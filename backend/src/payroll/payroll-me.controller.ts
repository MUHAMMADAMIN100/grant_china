import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PayslipsService } from './payslips.service';
import { periodKeyFor } from './period';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

/**
 * Раздел 5 ТЗ (волна 6) — личный кабинет: свои KPI в реальном времени и
 * предварительный расчёт зарплаты (ТЗ 5.2). НИ ОДИН метод не принимает
 * userId — идентичность ТОЛЬКО из JWT (@CurrentUser), запрос чужого id в
 * query/body игнорируется, а не «валидируется» (нечего проверять — нечего
 * и перепутать порядком проверок, см. accessModel проекта архитектора).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
@Controller('payroll/me')
export class PayrollMeController {
  constructor(private payslips: PayslipsService) {}

  @Get('kpi')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  kpi(@CurrentUser() user: any, @Query('period') period?: string) {
    return this.payslips.kpiForMe(user.id, period || periodKeyFor(new Date()));
  }

  @Get('preview')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  preview(@CurrentUser() user: any, @Query('period') period?: string) {
    return this.payslips.previewForMe(user.id, period || periodKeyFor(new Date()));
  }

  @Get('payslips')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  list(@CurrentUser() user: any, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.payslips.myList(user.id, { page: parsePage(page), pageSize: parsePageSize(pageSize) });
  }

  @Get('payslips/:id')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payslips.findOneForMe(id, user.id);
  }

  @Get('compensation')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  compensation(@CurrentUser() user: any) {
    return this.payslips.myCompensation(user.id);
  }

  @Get('rules')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  rules(@CurrentUser() user: any) {
    return this.payslips.myRules(user.id);
  }
}
