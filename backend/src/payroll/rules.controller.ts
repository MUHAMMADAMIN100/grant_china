import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BonusRuleSetStatus, Role } from '@prisma/client';
import { RulesService } from './rules.service';
import { PayslipsService } from './payslips.service';
import { periodKeyFor } from './period';
import { CreateBonusRuleDto, CreateBonusRuleSetDto, UpdateBonusRuleDto, UpdateBonusRuleSetDto } from './dto/bonus-rule.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

/**
 * Раздел 5 ТЗ (волна 6) — «изменение формул бонусов». Формула — СТРУКТУРНАЯ
 * КОНФИГУРАЦИЯ (тип + числа), см. dto/bonus-rule.dto.ts: ни один эндпоинт
 * не принимает текст выражения. ACTIVE-набор редактированию не подлежит НИ
 * ОДНИМ методом (loadDraftSet в rules.service.ts проверяет это на каждой
 * мутации) — «изменить формулы» технически означает «создать клон в DRAFT».
 * АКТИВАЦИЯ — необратимый шаг, доступна ТОЛЬКО FOUNDER.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.FOUNDER, Role.ADMIN)
@Controller('payroll/rules')
export class RulesController {
  constructor(
    private rules: RulesService,
    private payslips: PayslipsService,
  ) {}

  @Get('sets')
  @Roles(Role.FOUNDER, Role.ADMIN)
  listSets(@Query('status') status?: BonusRuleSetStatus) {
    return this.rules.listSets(status);
  }

  @Get('sets/:id')
  @Roles(Role.FOUNDER, Role.ADMIN)
  getSet(@Param('id') id: string) {
    return this.rules.getSet(id);
  }

  @Get('sets/:id/simulate')
  @Roles(Role.FOUNDER, Role.ADMIN)
  simulate(@Param('id') id: string, @Query('period') period?: string) {
    return this.payslips.simulate(id, period || periodKeyFor(new Date()));
  }

  // ТЗ v3 раздел 4: формулы бонусов задают, сколько сотрудники получат — это
  // финансовая часть, и Администратору она открыта только на чтение. GET'ы
  // выше (просмотр наборов и симуляция) ему остаются, запись — нет.
  @Post('sets')
  @Roles(Role.FOUNDER)
  createSet(@Body() dto: CreateBonusRuleSetDto, @CurrentUser() user: any) {
    return this.rules.createSet(dto, user);
  }

  @Patch('sets/:id')
  @Roles(Role.FOUNDER)
  updateSet(@Param('id') id: string, @Body() dto: UpdateBonusRuleSetDto, @CurrentUser() user: any) {
    return this.rules.updateSet(id, dto, user);
  }

  @Post('sets/:id/rules')
  @Roles(Role.FOUNDER)
  addRule(@Param('id') id: string, @Body() dto: CreateBonusRuleDto, @CurrentUser() user: any) {
    return this.rules.addRule(id, dto, user);
  }

  @Patch('rules/:ruleId')
  @Roles(Role.FOUNDER)
  updateRule(@Param('ruleId') ruleId: string, @Body() dto: UpdateBonusRuleDto, @CurrentUser() user: any) {
    return this.rules.updateRule(ruleId, dto, user);
  }

  @Delete('rules/:ruleId')
  @Roles(Role.FOUNDER)
  removeRule(@Param('ruleId') ruleId: string, @CurrentUser() user: any) {
    return this.rules.removeRule(ruleId, user);
  }

  @Post('sets/:id/activate')
  @Roles(Role.FOUNDER)
  activate(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rules.activate(id, user);
  }

  @Post('sets/:id/archive')
  @Roles(Role.FOUNDER)
  archive(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rules.archive(id, user);
  }
}
