import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parsePage, parsePageSize } from '../common/pagination';

function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ТЗ 6.3 — журнал звонков (заготовка под волну 7, только чтение). RolesGuard
// навешен явно, @Roles не используется — доступ считает CallsService.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('calls')
export class CallsController {
  constructor(private calls: CallsService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('studentId') studentId?: string,
    @Query('applicationId') applicationId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.calls.list(
      {
        studentId,
        applicationId,
        userId,
        from: parseDateParam(from),
        to: parseDateParam(to),
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.calls.findOne(id, user);
  }
}
