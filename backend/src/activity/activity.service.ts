import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isPrivileged } from '../common/roles';

export type ActivityAction =
  | 'STATUS_CHANGE'
  | 'STUDENT_UPDATE'
  | 'STUDENT_CREATE'
  | 'STUDENT_DELETE'
  | 'MANAGER_CHANGE'
  | 'PROGRAM_CHANGE'
  // Финансовый модуль (payments/) — Double Check (ТЗ 1.1). Поле action это
  // String в БД, миграция не нужна — новые значения добавляются только сюда
  // и в подписи фронта (frontend-crm/src/api/activity.ts, pages/Activity.tsx).
  | 'PAYMENT_CREATE'
  | 'PAYMENT_UPDATE'
  | 'PAYMENT_SUBMIT'
  | 'PAYMENT_RECALL'
  | 'PAYMENT_APPROVE'
  | 'PAYMENT_REJECT'
  | 'PAYMENT_VOID'
  | 'PAYMENT_DELETE'
  | 'PAYMENT_SCHEDULE_UPDATE';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway) {}

  async log(data: {
    actorId: string | null;
    actorName?: string;
    actorRole: string;
    action: ActivityAction;
    studentId?: string | null;
    studentName?: string | null;
    details: string;
    payload?: any;
  }) {
    let actorName = data.actorName || '';
    if (!actorName && data.actorId) {
      const u = await this.prisma.user.findUnique({
        where: { id: data.actorId },
        select: { fullName: true },
      });
      actorName = u?.fullName || 'Неизвестный';
    }
    const entry = await this.prisma.activityLog.create({
      data: {
        actorId: data.actorId,
        actorName: actorName || 'Неизвестный',
        actorRole: data.actorRole,
        action: data.action,
        studentId: data.studentId || null,
        studentName: data.studentName || null,
        details: data.details,
        payload: data.payload ?? undefined,
      },
    });
    // Проблема B аудита: раньше сюда летела вся `entry` (actorName,
    // studentId, studentName, details — включая дифф изменённых полей
    // студента) ВСЕМ сотрудникам. Activity.tsx на это событие просто
    // перезапрашивает журнал по HTTP, а list() там уже фильтрует по
    // роли (Проблема 3 Волны 0) — так что достаточно сигнала + id.
    this.realtime.emitAllStaff('activity:new', { id: entry.id });
    return entry;
  }

  async list(filters: {
    actorId?: string;
    studentId?: string;
    action?: ActivityAction;
    from?: Date;
    to?: Date;
    take?: number;
    /** Текущий пользователь — для ограничения видимости у EMPLOYEE (БАГ 3 аудита). */
    currentUserId?: string;
    currentUserRole?: Role;
  } = {}) {
    const where: any = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.studentId) where.studentId = filters.studentId;
    if (filters.action) where.action = filters.action;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }

    // БАГ 3 аудита: раньше EMPLOYEE видел журнал активности ВСЕХ сотрудников
    // компании и мог собрать оттуда studentId любого студента (а дальше
    // прочитать чужую карточку через БАГ 2). FOUNDER/ADMIN видят всё, как
    // и раньше. EMPLOYEE видит только свои действия и активность по
    // студентам, назначенным лично ему — страница «Активность» у него
    // продолжает работать, просто в рамках его студентов.
    if (!isPrivileged(filters.currentUserRole) && filters.currentUserId) {
      const myStudents = await this.prisma.student.findMany({
        where: {
          OR: [
            { managerId: filters.currentUserId },
            { chinaManagerId: filters.currentUserId },
          ],
        },
        select: { id: true },
      });
      const myStudentIds = myStudents.map((s) => s.id);
      where.OR = [
        { actorId: filters.currentUserId },
        ...(myStudentIds.length ? [{ studentId: { in: myStudentIds } }] : []),
      ];
    }

    // Верхний предел take — иначе ?take=1000000 выгружает журнал целиком
    // одним запросом (усилитель утечки + риск DoS по памяти).
    const take = Math.min(filters.take ?? 200, 200);

    return this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
