import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

class AskDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  question: string;
}

/**
 * ТЗ 6.1 — чат с AI-помощником. Доступен ВСЕМ ролям: смысл функции именно в
 * том, чтобы рядовой менеджер получал ответ по регламенту сам, не отвлекая
 * администратора.
 *
 * ПРИВАТНОСТЬ: userId всегда берётся из JWT (@CurrentUser), эндпоинтов чтения
 * чужой истории нет вовсе — тот же принцип, что в payroll/me. Сотрудник должен
 * иметь возможность спросить «как оформить возврат», не опасаясь, что вопрос
 * увидит руководитель.
 *
 * ЛИМИТ: 10 вопросов в минуту с одного пользователя. Каждый вопрос — платный
 * запрос к внешнему API, поэтому эндпоинт защищён строже глобального лимита
 * (тот же приём, что у публичной формы заявки и логина).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
@Controller('ai')
export class AiController {
  constructor(private ai: AiService) {}

  @Get('history')
  history(@CurrentUser() user: any) {
    return this.ai.history(user.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ask')
  ask(@Body() dto: AskDto, @CurrentUser() user: any) {
    return this.ai.ask(dto.question, user);
  }

  @Delete('history')
  clear(@CurrentUser() user: any) {
    return this.ai.clearHistory(user.id);
  }
}
