import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CompensationService } from './compensation.service';
import { SetCompensationDto } from './dto/compensation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

/**
 * ТЗ 2.8 — «кадровые ведомости», реестр окладов. ТОЛЬКО FOUNDER (см.
 * accessModel проекта архитектора): ADMIN видит начисленное в сводной
 * ведомости зарплат (/payroll/summary), но не управляет реестром ставок.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.FOUNDER)
@Controller('payroll/compensation')
export class CompensationController {
  constructor(private compensation: CompensationService) {}

  // userId ОБЯЗАТЕЛЕН. Prisma игнорирует `where: { userId: undefined }`,
  // поэтому вызов без параметра возвращал историю ставок ВСЕХ сотрудников
  // одним ответом. Сегодня это закрыто ролью, но эндпоинт «история одного
  // человека», молча отдающий весь реестр компании, — заряженное ружьё:
  // достаточно однажды ослабить роль или переиспользовать метод в другом
  // месте. Ограничение выражено в контракте, а не держится на @Roles.
  @Get()
  @Roles(Role.FOUNDER)
  history(@Query('userId') userId?: string) {
    if (!userId) {
      throw new BadRequestException('Укажите userId — история ставок запрашивается по одному сотруднику');
    }
    return this.compensation.history(userId);
  }

  @Get('current')
  @Roles(Role.FOUNDER)
  current() {
    return this.compensation.current();
  }

  @Post()
  @Roles(Role.FOUNDER)
  set(@Body() dto: SetCompensationDto, @CurrentUser() user: any) {
    return this.compensation.set(dto, user);
  }

  @Delete(':id')
  @Roles(Role.FOUNDER)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.compensation.remove(id, user);
  }
}
