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
  constructor(private users: UsersService) {}

  @Get()
  @Roles(Role.FOUNDER, Role.ADMIN)
  list(@Query('search') search?: string) {
    return this.users.findAll({ search });
  }

  @Post()
  @Roles(Role.FOUNDER)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
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
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.FOUNDER)
  async remove(@Param('id') id: string, @CurrentUser() current: { sub: string }) {
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
    return this.users.remove(id);
  }
}
