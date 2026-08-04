import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ContractStatus, Role } from '@prisma/client';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { SignContractDto, TerminateContractDto, UpdateContractDto } from './dto/update-contract.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Раздел 5 ТЗ (волна 6) — договоры. РЕШЕНИЕ ЗАКАЗЧИКА: отдельная сущность,
 * не статус заявки. RolesGuard навешен явно (не глобальный), но @Roles на
 * классе НЕ ставится — видимость/права считает ContractsService по
 * canAccessStudentRecord (тот же приём, что grants.controller.ts/
 * consultations.controller.ts). @Roles на методе используется только там,
 * где ТЗ прямо ограничивает круг лиц.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private contracts: ContractsService) {}

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('status') status?: ContractStatus,
    @Query('managerId') managerId?: string,
    @Query('studentId') studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.contracts.findAll(
      {
        status,
        managerId,
        studentId,
        from: parseDateParam(from),
        to: parseDateParam(to),
        search,
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  @Get('stats')
  stats(@CurrentUser() user: any) {
    return this.contracts.stats(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contracts.findOne(id, user);
  }

  // ТЗ v3 раздел 4: договор несёт СУММУ, то есть относится к финансовой части,
  // где Администратор работает только на просмотр. Менеджер черновик готовит
  // (сумма по своему студенту), Основатель подписывает — Double Check цел.
  @Post()
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  create(@Body() dto: CreateContractDto, @CurrentUser() user: any) {
    return this.contracts.create(dto, user);
  }

  @Patch(':id')
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  update(@Param('id') id: string, @Body() dto: UpdateContractDto, @CurrentUser() user: any) {
    return this.contracts.update(id, dto, user);
  }

  // ПОДПИСАНИЕ — ТОЛЬКО FOUNDER, второй человек в цепочке.
  //
  // Договор — это база бонуса менеджера: от его суммы и факта подписания
  // считаются и конверсия, и процент к зарплате. Без этого ограничения
  // цепочка замыкалась на одном человеке: менеджер сам создаёт студента,
  // сам создаёт договор, сам проставляет сумму, сам себя ставит
  // ответственным и сам подписывает — второго участника нет вообще.
  // Это тот же принцип, что Double Check у платежей (ТЗ 1.1): вносит один,
  // подтверждает другой. Черновик менеджер по-прежнему готовит сам.
  //
  // ADMIN убран из списка по ТЗ v3 (критерий приёмки №4): подписание фиксирует
  // сумму договора и запускает начисление бонуса — это изменение в финансовой
  // части, а не просмотр. Второй участник цепочки теперь Основатель.
  @Post(':id/sign')
  @Roles(Role.FOUNDER)
  sign(@Param('id') id: string, @Body() dto: SignContractDto, @CurrentUser() user: any) {
    return this.contracts.sign(id, dto, user);
  }

  @Post(':id/terminate')
  @Roles(Role.FOUNDER)
  terminate(@Param('id') id: string, @Body() dto: TerminateContractDto, @CurrentUser() user: any) {
    return this.contracts.terminate(id, dto, user);
  }

  @Post(':id/complete')
  @Roles(Role.FOUNDER)
  complete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contracts.complete(id, user);
  }

  @Delete(':id')
  @Roles(Role.FOUNDER)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contracts.remove(id, user);
  }

  @Post(':id/link-payments')
  @Roles(Role.FOUNDER)
  linkPayments(@Param('id') id: string, @CurrentUser() user: any) {
    return this.contracts.linkPayments(id, user);
  }
}
