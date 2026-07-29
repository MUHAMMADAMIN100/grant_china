import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { isFounder } from '../common/roles';

function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Раздел 2.6 ТЗ — финансовая аналитика. По ТЗ Основатель видит «финансовую
 * аналитику», Администратор — «операционный контроль» (ему запрещено только
 * ЕДИНОЛИЧНО закрывать транзакции — approve/reject/void в payments.controller.ts
 * остаются @Roles(FOUNDER)). Аналитика — это отчётность для контроля бизнеса,
 * а не финансовая операция, поэтому ADMIN сюда допущен вместе с FOUNDER.
 *
 * ИСКЛЮЧЕНИЕ — срез byManager («кто сколько собрал», поимённо). Он вырезается
 * для Администратора: это уже не операционный контроль, а кадровая оценка
 * сотрудников, а кадровые ведомости ТЗ относит к исключительным разделам
 * Основателя. Плюс в волне 6 на этих же цифрах будет считаться бонусная часть
 * зарплаты — тогда byManager станет прямо зарплатными данными, и открывать их
 * Администратору тем более нельзя.
 *
 * Отдельный контроллер (не внутри PaymentsController) — эндпоинты только для
 * чтения агрегатов по всему портфелю, разная модель прав и разная нагрузка
 * на БД по сравнению с CRUD одного платежа.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.FOUNDER, Role.ADMIN)
@Controller('payments/analytics')
export class FinanceAnalyticsController {
  constructor(private analytics: FinanceAnalyticsService) {}

  @Get('summary')
  async summary(
    @CurrentUser() user: { role: Role },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const result = await this.analytics.summary({
      from: parseDateParam(from),
      to: parseDateParam(to),
    });
    // Режем на выходе, а не отдельным запросом: агрегат считается одним
    // проходом, и разделять его на два эндпоинта ради одной ветки прав —
    // лишняя нагрузка на БД и второй источник правды для тех же чисел.
    if (!isFounder(user.role)) {
      const { byManager, ...rest } = result as any;
      return rest;
    }
    return result;
  }
}
