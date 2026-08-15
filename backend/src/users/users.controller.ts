import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffBotService } from '../telegram/staff-bot.service';

/**
 * Управление сотрудниками.
 *  - GET /users — список доступен FOUNDER и ADMIN (ADMIN видит read-only).
 *  - POST/PATCH/DELETE /users — только FOUNDER (Основатель). Это
 *    единственная роль, которая может изменять данные сотрудников,
 *    их пароли и назначать роли.
 *
 * Дополнительная защита от блокировки: нельзя удалить или понизить
 * последнего FOUNDER в системе (иначе некому будет менять роли).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private users: UsersService,
    private staffBot: StaffBotService,
  ) {}

  /**
   * Привязка своего Telegram (12.08.2026). БЕЗ @Roles намеренно: каждый
   * сотрудник подключает СВОЙ мессенджер, и роль тут ни при чём. userId
   * всегда берётся из токена — подключить чужой Telegram нельзя даже
   * подделав тело запроса, потому что тела у этих запросов нет.
   *
   * Объявлены ВЫШЕ маршрутов с параметром (:id) — иначе 'me' попал бы в них
   * как значение параметра.
   */
  @Get('me/telegram')
  telegramStatus(@CurrentUser() current: { sub: string }) {
    return this.staffBot.statusFor(current.sub);
  }

  @Post('me/telegram/link')
  async telegramLink(@CurrentUser() current: { sub: string }) {
    const url = await this.staffBot.buildLinkUrl(current.sub);
    return { url };
  }

  @Post('me/telegram/unlink')
  async telegramUnlink(@CurrentUser() current: { sub: string }) {
    await this.staffBot.unlink(current.sub);
    return { ok: true };
  }

  @Get()
  @Roles(Role.FOUNDER, Role.ADMIN)
  list(@Query('search') search?: string) {
    return this.users.findAll({ search });
  }

  @Post()
  @Roles(Role.FOUNDER)
  create(@Body() dto: CreateUserDto, @CurrentUser() current: { sub: string; role: Role }) {
    return this.users.create(dto, { id: current.sub, role: current.role });
  }

  @Patch(':id')
  @Roles(Role.FOUNDER)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() current: { sub: string; role: Role },
  ) {
    // Защита: нельзя понизить последнего FOUNDER, иначе некому управлять
    // ролями. Если меняется role у пользователя, у которого роль была
    // FOUNDER, и он становится не-FOUNDER — проверяем что он не последний.
    if (dto.role && dto.role !== Role.FOUNDER) {
      const target = await this.users.findOneRaw(id);
      if (target?.role === Role.FOUNDER) {
        const founderCount = await this.users.countByRole(Role.FOUNDER);
        if (founderCount <= 1) {
          throw new ForbiddenException(
            'Нельзя понизить последнего Основателя. Сначала назначьте другого FOUNDER.',
          );
        }
      }
    }
    return this.users.update(id, dto, { id: current.sub, role: current.role });
  }

  @Delete(':id')
  @Roles(Role.FOUNDER)
  async remove(@Param('id') id: string, @CurrentUser() current: { sub: string; role: Role }) {
    if (id === current.sub) {
      throw new ForbiddenException('Нельзя удалить самого себя.');
    }
    const target = await this.users.findOneRaw(id);
    if (target?.role === Role.FOUNDER) {
      const founderCount = await this.users.countByRole(Role.FOUNDER);
      if (founderCount <= 1) {
        throw new ForbiddenException(
          'Нельзя удалить последнего Основателя.',
        );
      }
    }
    return this.users.remove(id, { id: current.sub, role: current.role });
  }
}
