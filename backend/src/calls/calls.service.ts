import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isFounder, isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';

export type CurrentUser = { id: string; role: Role };

const CALL_INCLUDE = {
  user: { select: { id: true, fullName: true } },
  student: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  application: { select: { id: true, fullName: true, managerId: true, chinaManagerId: true } },
  consultation: { select: { id: true, fullName: true } },
} as const;

export interface CallListFilters {
  studentId?: string;
  applicationId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

/**
 * ТЗ 6.3 — заготовка под IP-телефонию (волна 7). В ЭТОЙ волне только чтение:
 * записей ноль (эндпоинта создания намеренно нет — см. callModel проекта
 * архитектора), но CRUD-каркас чтения/прав нужен уже сейчас, чтобы карточка
 * студента и волна 7 могли на него опереться без переделок.
 */
@Injectable()
export class CallsService {
  constructor(private prisma: PrismaService) {}

  /**
   * raw — сырой payload вебхука провайдера, содержит PII звонка. Отдаётся
   * ТОЛЬКО FOUNDER (не ADMIN, не EMPLOYEE) — см. callModel проекта архитектора.
   */
  private strip<T extends { raw?: unknown }>(call: T, user: CurrentUser): T {
    if (isFounder(user.role)) return call;
    const { raw, ...rest } = call as any;
    return rest;
  }

  async list(filters: CallListFilters, user: CurrentUser) {
    const and: Prisma.CallWhereInput[] = [];
    if (filters.studentId) and.push({ studentId: filters.studentId });
    if (filters.applicationId) and.push({ applicationId: filters.applicationId });
    if (filters.userId) and.push({ userId: filters.userId });
    if (filters.from || filters.to) {
      const startedAt: Prisma.DateTimeFilter = {};
      if (filters.from) startedAt.gte = filters.from;
      if (filters.to) startedAt.lte = filters.to;
      and.push({ startedAt });
    }
    // EMPLOYEE видит только звонки на своей внутренней линии либо привязанные
    // к «своим» студентам/заявкам — та же формула, что и у остальных
    // сущностей проекта (canAccessStudentRecord), но выраженная через where,
    // а не постфильтром (звонков может быть много, в отличие от грантов).
    if (!isPrivileged(user.role)) {
      and.push({
        OR: [
          { userId: user.id },
          { student: { OR: [{ managerId: user.id }, { chinaManagerId: user.id }] } },
          { application: { OR: [{ managerId: user.id }, { chinaManagerId: user.id }] } },
        ],
      });
    }
    const where: Prisma.CallWhereInput = { deletedAt: null, ...(and.length ? { AND: and } : {}) };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.call.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: pageSize,
        include: CALL_INCLUDE,
      }),
      this.prisma.call.count({ where }),
    ]);
    return { items: items.map((c) => this.strip(c, user)), total, page, pageSize };
  }

  async findOne(id: string, user: CurrentUser) {
    const call = await this.prisma.call.findFirst({ where: { id, deletedAt: null }, include: CALL_INCLUDE });
    if (!call) throw new NotFoundException('Звонок не найден');
    const hasAccess =
      isPrivileged(user.role) ||
      call.userId === user.id ||
      (call.student && canAccessStudentRecord(call.student, user)) ||
      (call.application && canAccessStudentRecord(call.application, user));
    // 404, а не 403 — не быть оракулом существования id.
    if (!hasAccess) throw new NotFoundException('Звонок не найден');
    return this.strip(call, user);
  }
}
