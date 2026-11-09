import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SALES_PERIODS, SalesAnalyticsService, SalesPeriodKey } from './sales-analytics.service';

/**
 * 09.11.2026 — Аналитика → «Продажи». Открыта всем сотрудникам: руководство
 * видит всех и может выбрать сотрудника, менеджер — только свои цифры
 * (сужает сервис, параметр employee для менеджера не действует).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class SalesAnalyticsController {
  constructor(private sales: SalesAnalyticsService) {}

  @Get('sales')
  summary(@CurrentUser() user: any, @Query('period') period?: string, @Query('employee') employee?: string) {
    const key = (period || 'month') as SalesPeriodKey;
    if (!SALES_PERIODS.includes(key)) throw new BadRequestException('Период: today, week, month или year');
    return this.sales.summary({ id: user.id, role: user.role, region: user.region }, key, employee || undefined);
  }
}
