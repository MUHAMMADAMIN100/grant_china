import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ActivityService } from '../activity/activity.service';
import { StorageService } from './storage.service';

/**
 * 07.09.2026 — диск загрузок для руководства: свободное место и проба
 * записи (плитка на дашборде), отчёт о файлах-сиротах и их уборка.
 *
 * Здоровье видят Основатель и Администратор — оба отвечают за то, что
 * сотрудники могут работать. Уборка — только Основатель: это единственное
 * место в системе, где файл удаляется с диска физически, и решение об этом
 * принимает один человек, после отчёта.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('storage')
export class StorageController {
  constructor(
    private storage: StorageService,
    private activity: ActivityService,
  ) {}

  @Get('health')
  @Roles(Role.FOUNDER, Role.ADMIN)
  health() {
    return this.storage.health();
  }

  @Get('orphans')
  @Roles(Role.FOUNDER)
  orphans() {
    return this.storage.scanOrphans();
  }

  @Post('orphans/purge')
  @Roles(Role.FOUNDER)
  async purge(@Body() body: { names?: string[] }, @CurrentUser() user: { sub: string; role: Role }) {
    const result = await this.storage.purgeOrphans(body?.names ?? []);
    this.activity
      .log({
        actorId: user.sub,
        actorRole: user.role,
        action: 'STORAGE_PURGE',
        details: `Уборка файлов-сирот: удалено ${result.deleted.length}, освобождено ${(result.freedBytes / 1048576).toFixed(1)} МБ, пропущено ${result.skipped.length}`,
        payload: { deleted: result.deleted.slice(0, 200), freedBytes: result.freedBytes },
      })
      .catch(() => undefined);
    return result;
  }
}
