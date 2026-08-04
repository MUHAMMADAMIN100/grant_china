import { Prisma, Region, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assignedToUserFilter } from '../common/access';
import { isPrivileged } from '../common/roles';

/**
 * Срез данных по студентам для AI-помощника (решение заказчика: помощник
 * отвечает и по регламентам, и по своим студентам).
 *
 * ГЛАВНОЕ ПРАВИЛО: помощник видит РОВНО ТО ЖЕ, что и сам сотрудник в разделе
 * «Студенты», ни строкой больше. Формула доступа не своя, а общая с остальным
 * проектом (assignedToUserFilter из common/access.ts) — если бы здесь стояла
 * копия условия, она разъехалась бы с основной ровно так же, как это уже
 * произошло с регионами в пяти списках.
 *
 * Практически это значит:
 *  - Основатель и Администратор видят всех студентов;
 *  - менеджер — только назначенных лично ему, и только по профильному для
 *    его региона полю (Таджикистан — managerId, Китай — chinaManagerId);
 *  - «свободные» студенты (без менеджеров) сюда НЕ попадают: в списке
 *    студентов их тоже нет.
 *
 * ЧЕГО ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО: пароля, паспортных сканов, ссылок на файлы,
 * анкеты. Помощник отвечает на вопросы вида «кому продлевать визу» и «у кого
 * не хватает документов», и для этого достаточно фактов, а не содержимого
 * документов. Чем меньше уходит во внешний сервис, тем лучше.
 */

/**
 * Сколько студентов максимум попадает в контекст.
 *
 * Ограничение не про экономию, а про качество ответа: чем длиннее список, тем
 * хуже модель удерживает его целиком, и тем выше шанс, что она «потеряет»
 * строку в середине. Двести — с запасом покрывает текущую базу агентства
 * (204 студента), а при росте помощник честно предупредит, что видит не всех.
 */
const MAX_STUDENTS = 200;

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'активен',
  PAUSED: 'на паузе',
  GRADUATED: 'выпустился',
  ARCHIVED: 'в архиве',
};

const DIRECTION_LABEL: Record<string, string> = {
  BACHELOR: 'бакалавриат',
  MASTER: 'магистратура',
  LANGUAGE: 'языковые курсы',
  LANGUAGE_COLLEGE: 'языковой + колледж',
  LANGUAGE_BACHELOR: 'языковой + бакалавриат',
  COLLEGE: 'колледж',
};

const APPLICATION_STAGE_LABEL: Record<string, string> = {
  NEW: 'новая заявка',
  DOCS_REVIEW: 'документы на проверке',
  DOCS_SUBMITTED: 'документы поданы',
  PRE_ADMISSION: 'предварительное зачисление',
  AWAITING_PAYMENT: 'ожидает оплаты',
  ENROLLED: 'зачислен',
  IN_PROGRESS: 'в работе',
  COMPLETED: 'завершена',
};

export interface StudentContextUser {
  id: string;
  role: Role | string;
  region?: Region | string | null;
}

export interface StudentContext {
  /** Готовый текст для промпта. Пустая строка — доступных студентов нет. */
  text: string;
  /** Сколько студентов реально попало в контекст. */
  included: number;
  /** Сколько всего доступно пользователю (может быть больше included). */
  total: number;
  truncated: boolean;
}

/** Условие видимости студентов — то же, что в списке раздела «Студенты». */
function scopeWhere(user: StudentContextUser): Prisma.StudentWhereInput {
  const where: Prisma.StudentWhereInput = { deletedAt: null };
  if (isPrivileged(user.role)) return where;
  return {
    ...where,
    OR: assignedToUserFilter({ id: user.id, role: user.role, region: user.region }) as Prisma.StudentWhereInput[],
  };
}

export async function buildStudentContext(
  prisma: PrismaService,
  user: StudentContextUser,
): Promise<StudentContext> {
  const where = scopeWhere(user);

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_STUDENTS,
      select: {
        id: true,
        fullName: true,
        direction: true,
        cabinet: true,
        status: true,
        visaReceived: true,
        visaReceivedAt: true,
        manager: { select: { fullName: true } },
        chinaManager: { select: { fullName: true } },
        program: { select: { name: true, city: true } },
        applications: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
        grants: {
          where: { deletedAt: null },
          select: { totalYears: true, status: true, nextYearStartsAt: true },
        },
        documents: {
          where: { deletedAt: null },
          select: { type: true },
        },
      },
    }),
  ]);

  if (students.length === 0) {
    return { text: '', included: 0, total, truncated: false };
  }

  // Деньги — одним агрегатом на всех, а не запросом на студента: иначе двести
  // студентов означали бы двести обращений к базе на КАЖДЫЙ вопрос сотрудника.
  const ids = students.map((s) => s.id);
  const [paid, planned] = await Promise.all([
    prisma.payment.groupBy({
      by: ['studentId'],
      where: { studentId: { in: ids }, status: 'APPROVED', deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.paymentSchedule.groupBy({
      by: ['studentId'],
      where: { studentId: { in: ids }, deletedAt: null },
      _sum: { plannedAmount: true },
    }),
  ]);
  const paidById = new Map(paid.map((r) => [r.studentId, Number(r._sum.amount ?? 0)]));
  const plannedById = new Map(planned.map((r) => [r.studentId, Number(r._sum.plannedAmount ?? 0)]));

  const lines = students.map((s) => {
    const stage = s.applications[0]?.status;
    const activeGrants = s.grants.filter((g) => g.status === 'ACTIVE');
    const multi = activeGrants.some((g) => g.totalYears > 1);
    const docTypes = new Set(s.documents.map((d) => d.type).filter(Boolean));
    const paidSum = paidById.get(s.id) ?? 0;
    const plannedSum = plannedById.get(s.id) ?? 0;

    const parts = [
      s.fullName,
      `направление: ${DIRECTION_LABEL[s.direction] ?? s.direction}`,
      `кабинет ${s.cabinet}`,
      `статус: ${STATUS_LABEL[s.status] ?? s.status}`,
      stage ? `этап: ${APPLICATION_STAGE_LABEL[stage] ?? stage}` : 'заявки нет',
      `виза: ${s.visaReceived ? 'получена' : 'не получена'}`,
      s.program ? `программа: ${s.program.name}${s.program.city ? ` (${s.program.city})` : ''}` : null,
      activeGrants.length
        ? `грант: ${multi ? 'двойной, продлевать ежегодно' : 'разовый'}${
            activeGrants[0].nextYearStartsAt
              ? `, следующий год с ${activeGrants[0].nextYearStartsAt.toISOString().slice(0, 10)}`
              : ''
          }`
        : 'гранта нет',
      `документов загружено: ${docTypes.size}`,
      `оплачено: ${paidSum.toFixed(2)} сомони`,
      plannedSum > 0 ? `по графику всего: ${plannedSum.toFixed(2)} сомони` : null,
      s.manager ? `менеджер TJ: ${s.manager.fullName}` : null,
      s.chinaManager ? `менеджер CN: ${s.chinaManager.fullName}` : null,
    ].filter(Boolean);

    return `- ${parts.join('; ')}`;
  });

  return {
    text: lines.join('\n'),
    included: students.length,
    total,
    truncated: total > students.length,
  };
}
