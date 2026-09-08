import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { LeadSourcesService } from './lead-sources.service';

export class CreateLeadSourceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label!: string;
}

export class UpdateLeadSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

/**
 * 08.09.2026 — источники привлечения. Список и добавление — любому
 * сотруднику (менеджер добавляет прямо в работе, не ждёт руководство);
 * переименование и скрытие — Основателю и Администратору, вкладка
 * «Источники» в разделе «Пользователи».
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lead-sources')
export class LeadSourcesController {
  constructor(private leadSources: LeadSourcesService) {}

  @Get()
  async list() {
    return { items: await this.leadSources.list() };
  }

  @Post()
  create(@Body() dto: CreateLeadSourceDto, @CurrentUser() user: { sub: string; role: string }) {
    return this.leadSources.createOrGet(dto.label, user);
  }

  @Patch(':code')
  @Roles(Role.FOUNDER, Role.ADMIN)
  update(@Param('code') code: string, @Body() dto: UpdateLeadSourceDto, @CurrentUser() user: { sub: string; role: string }) {
    return this.leadSources.update(code, dto, user);
  }
}
