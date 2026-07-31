import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SchedulerService } from './scheduler.service';
import { SchedulerLockService } from './scheduler-lock.service';

/**
 * Наблюдаемость планировщика (schedulerPlan проекта архитектора): молчащий
 * планировщик — самый частый и самый незаметный отказ такого рода, без
 * этого экрана его обнаруживают через месяц по жалобе "мне не приходят напоминания".
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('scheduler')
export class SchedulerController {
  constructor(private scheduler: SchedulerService, private lock: SchedulerLockService) {}

  @Get('status')
  @Roles(Role.FOUNDER, Role.ADMIN)
  status() {
    return this.lock.status();
  }

  // Ручной прогон — проверить логику джобы в проде, не дожидаясь 15 минут.
  // Только FOUNDER: авто-архив (AUTO_ARCHIVE_MODE=on) необратимо (в рамках
  // "необратимо" = требует ручного "Вернуть из архива") трогает данные компании.
  @Post('run/:job')
  @Roles(Role.FOUNDER)
  async run(@Param('job') job: string) {
    const ok = await this.scheduler.runByName(job);
    if (!ok) {
      // false означает либо "джобы с таким именем нет", либо "уже
      // выполняется/лок не протух" — различать не нужно: в обоих случаях
      // ручной запуск сейчас невозможен.
      return { ok: false, message: 'Джоба не найдена или уже выполняется' };
    }
    return { ok: true };
  }
}
