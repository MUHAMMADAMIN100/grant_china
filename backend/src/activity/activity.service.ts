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
  | 'PAYMENT_SCHEDULE_UPDATE'
  // Раздел 2.12 ТЗ (управление правами) — кадровые события, должны попадать
  // в журнал Основателя: кто и когда завёл/удалил сотрудника или сменил ему
  // роль. Пишутся из users.service.ts (единственная точка, где это возможно —
  // @Roles(FOUNDER) в users.controller.ts).
  | 'USER_CREATE'
  | 'USER_ROLE_CHANGE'
  | 'USER_DELETE'
  // Раздел 3 ТЗ (волна 3) — заявки: архив/источник. Пишутся из
  // applications.service.ts.
  | 'APPLICATION_ARCHIVE'
  | 'APPLICATION_UNARCHIVE'
  | 'APPLICATION_SOURCE_CHANGE'
  | 'APPLICATION_CLEAR_REPEAT'
  // Раздел 3.2 ТЗ — консультации/собеседования. Пишутся из
  // consultations.service.ts. actorId может быть null (планировщик/системные
  // действия — см. jobs/application-auto-archive.job.ts, которая переиспользует
  // APPLICATION_ARCHIVE выше с actorId: null).
  | 'CONSULTATION_CREATE'
  | 'CONSULTATION_UPDATE'
  | 'CONSULTATION_DELETE'
  | 'CONSULTATION_CONVERT'
  // Системная (авто-созданная) задача — TasksService.createSystemTask().
  // Единая точка входа для ВСЕХ автозадач: сейчас это консультации (ТЗ 3.2)
  // и напоминания о начале учебного года (раздел 4, волна 4) — оба случая
  // логируются этим же action без правок в местах вызова.
  | 'TASK_AUTO_CREATE'
  // Раздел 6.3 ТЗ (волна 4) — ручное создание задачи (в отличие от
  // TASK_AUTO_CREATE выше). Пишется из tasks.service.ts create().
  | 'TASK_CREATE'
  // Раздел 6.3 ТЗ — «прикрепление чеков» как ОТДЕЛЬНОЕ событие ленты (раньше
  // размазано по PAYMENT_UPDATE — было невозможно отфильтровать в UI).
  // Пишутся из payments.service.ts create()/addReceipt()/removeReceipt().
  | 'PAYMENT_RECEIPT_ADD'
  | 'PAYMENT_RECEIPT_REMOVE'
  // Раздел 6.3 ТЗ — загрузка/удаление обычного документа студента (паспорт,
  // диплом и т.п., не чек). Пишутся из students.service.ts addDocument()/removeDocument().
  | 'DOCUMENT_UPLOAD'
  | 'DOCUMENT_DELETE'
  // Раздел 6.3 ТЗ — текстовые комментарии как события ленты (новая модель
  // Comment, отдельная от Student.comment/Application.comment). Пишутся из
  // comments.service.ts.
  | 'COMMENT_CREATE'
  | 'COMMENT_UPDATE'
  | 'COMMENT_DELETE'
  // Раздел 6.3 ТЗ — заготовка под IP-телефонию (волна 7). Тип события заведён
  // сейчас, вызовов пока нет (новая модель Call, записей в волне 4 не создаётся).
  | 'CALL_LOGGED'
  // Раздел 4 ТЗ (волна 4) — реестр студентов с «двойным грантом». Пишутся из
  // grants.service.ts.
  | 'GRANT_CREATE'
  | 'GRANT_UPDATE'
  | 'GRANT_YEAR_ADVANCE'
  | 'GRANT_CLOSE'
  // Раздел 5 ТЗ (волна 6) — договоры (contracts.service.ts). Кадровое/финансовое
  // событие, studentId ЕСТЬ (у контракта всегда есть studentId) — попадает
  // в фильтр видимости EMPLOYEE (см. list() ниже) как активность его студента.
  | 'CONTRACT_CREATE'
  | 'CONTRACT_SIGN'
  | 'CONTRACT_TERMINATE'
  | 'CONTRACT_UPDATE'
  // Раздел 5 ТЗ (волна 6) — зарплата и формулы бонусов (payroll/). ВСЕ пишутся
  // со studentId: null намеренно — это кадровые/финансовые события, а не
  // события карточки студента; фильтр видимости EMPLOYEE (см. list() ниже:
  // OR по actorId и studentId своих студентов) их менеджеру не покажет —
  // рядовой сотрудник не должен узнавать чужой оклад/бонус из журнала.
  | 'PAYROLL_GENERATE'
  | 'PAYROLL_RECALC'
  | 'PAYROLL_ADJUST'
  | 'PAYROLL_APPROVE'
  | 'PAYROLL_RECALL'
  | 'PAYROLL_PAY'
  | 'PAYROLL_VOID'
  | 'PAYROLL_REISSUE'
  | 'PAYROLL_DRAFT_DELETE'
  | 'PAYROLL_RULESET_CREATE'
  | 'PAYROLL_RULESET_ACTIVATE'
  | 'PAYROLL_RULESET_ARCHIVE'
  // ТЗ 2.8 — кадровые ведомости (compensation.service.ts).
  | 'COMPENSATION_SET';

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
