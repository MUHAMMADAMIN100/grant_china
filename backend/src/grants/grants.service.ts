import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GrantIntake, GrantStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { CreateGrantDto } from './dto/create-grant.dto';
import { UpdateGrantDto } from './dto/update-grant.dto';
import { AdvanceGrantDto } from './dto/advance-grant.dto';
import { TasksService } from '../tasks/tasks.service';
import {
  academicYearOriginKey,
  addYears,
  detectIntake,
  formatDateRuShort,
  ordinalYearRu,
  parseCalendarDate,
} from './grant-year';

export type CurrentUser = { id: string; role: Role };

const GRANT_INCLUDE = {
  // phones нужен reminderTaskInput(): джоба кладёт телефон в описание задачи, и
  // без него пересинхронизация при переносе даты СТИРАЛА бы строку с телефоном
  // (prisma.task.update перезаписывает description целиком).
  student: {
    select: { id: true, fullName: true, phones: true, managerId: true, chinaManagerId: true, status: true },
  },
  createdBy: { select: { id: true, fullName: true } },
} as const;

export interface GrantListFilters {
  /** ТЗ 4 — реестр «двойных грантов» по умолчанию (totalYears > 1). */
  multiOnly?: boolean;
  status?: GrantStatus;
  intake?: GrantIntake;
  managerId?: string;
  studentId?: string;
  search?: string;
  /** Ближайший старт следующего учебного года ≤ N дней. */
  dueInDays?: number;
  page?: number;
  pageSize?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Строка гранта в том виде, в каком её отдаёт любой метод сервиса. */
type GrantRow = Prisma.StudentGrantGetPayload<{ include: typeof GRANT_INCLUDE }>;

// dueDate напоминания «Новый учебный год» — те же цифры, что у джобы
// (DUE_LEAD_MS/MIN_DUE_LEAD_MS в academic-year-reminder.job.ts): за 30 дней до
// старта, но не в прошлом. Расходиться им нельзя — иначе после переноса даты
// у той же задачи оказался бы срок, посчитанный по другому правилу.
const REMINDER_DUE_LEAD_MS = 30 * DAY_MS;
const REMINDER_MIN_DUE_LEAD_MS = DAY_MS;

@Injectable()
export class GrantsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
    // Единственная зависимость модуля: автозадачу «Новый учебный год» создаёт
    // планировщик, но ДЕРЖАТЬ её в согласии с датой обязан тот, кто дату
    // меняет. Прямой доступ к prisma.task отсюда запрещён архитектурой —
    // только через TasksService (тот же приём, что в consultations.service.ts).
    private tasks: TasksService,
  ) {}

  /**
   * Условие доступа к студенту, к которому привязан грант — тот же принцип,
   * что и у остальных сущностей проекта (canAccessStudentRecord): FOUNDER/ADMIN
   * видят всё, EMPLOYEE — назначенных лично ему или «свободных» студентов.
   * `extra` — дополнительные условия (поиск по ФИО, фильтр по менеджеру),
   * объединяются через AND в ОДНОМ ключе `student`, потому что Prisma не
   * допускает два разных условия на одно и то же relation-поле объекта.
   */
  private studentScopeWhere(user: CurrentUser, extra: Prisma.StudentWhereInput[] = []): Prisma.StudentWhereInput {
    const and: Prisma.StudentWhereInput[] = [...extra];
    if (!isPrivileged(user.role)) {
      and.push({
        OR: [{ managerId: null, chinaManagerId: null }, { managerId: user.id }, { chinaManagerId: user.id }],
      });
    }
    return and.length ? { deletedAt: null, AND: and } : { deletedAt: null };
  }

  /**
   * Доступ к самому гранту (чтение И запись — правило одно, как у
   * консультаций): владелец студента либо FOUNDER/ADMIN. 404, а не 403 — не
   * быть оракулом существования id (тот же приём, что в consultations.service.ts).
   */
  private async loadForMutation(id: string, user: CurrentUser) {
    const grant = await this.prisma.studentGrant.findFirst({
      where: { id, deletedAt: null },
      include: GRANT_INCLUDE,
    });
    if (!grant) throw new NotFoundException('Грант не найден');
    if (!canAccessStudentRecord(grant.student, user)) throw new NotFoundException('Грант не найден');
    return grant;
  }

  /** IDOR-защита при создании: студент должен существовать и быть доступен пользователю. */
  private async loadStudentForLink(studentId: string, user: CurrentUser) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
    });
    if (!student || !canAccessStudentRecord(student, user)) {
      throw new NotFoundException('Студент не найден');
    }
    return student;
  }

  async findAll(filters: GrantListFilters, user: CurrentUser) {
    const and: Prisma.StudentGrantWhereInput[] = [];
    // ТЗ 4 — реестр «двойных грантов» по умолчанию. multiOnly === false явно
    // просит показать вообще все гранты (в т.ч. разовые, на 1 год).
    if (filters.multiOnly !== false) and.push({ totalYears: { gt: 1 } });
    if (filters.status) and.push({ status: filters.status });
    if (filters.intake) and.push({ intake: filters.intake });
    if (filters.studentId) and.push({ studentId: filters.studentId });
    if (filters.dueInDays !== undefined && filters.dueInDays >= 0) {
      const upper = new Date(Date.now() + filters.dueInDays * DAY_MS);
      and.push({ nextYearStartsAt: { not: null, lte: upper } });
    }

    const studentExtra: Prisma.StudentWhereInput[] = [];
    if (filters.managerId) {
      studentExtra.push({ OR: [{ managerId: filters.managerId }, { chinaManagerId: filters.managerId }] });
    }
    if (filters.search) {
      studentExtra.push({ fullName: { contains: filters.search, mode: 'insensitive' } });
    }
    and.push({ student: this.studentScopeWhere(user, studentExtra) });

    const where: Prisma.StudentGrantWhereInput = { deletedAt: null, AND: and };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.studentGrant.findMany({
        where,
        // Ближайший старт следующего учебного года сверху, гранты без
        // плановой даты (COMPLETED/TERMINATED/SUSPENDED) — в конце.
        orderBy: [{ nextYearStartsAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        include: GRANT_INCLUDE,
      }),
      this.prisma.studentGrant.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async stats(user: CurrentUser) {
    const base: Prisma.StudentGrantWhereInput = { deletedAt: null, student: this.studentScopeWhere(user) };
    const dueSoonUpper = new Date(Date.now() + 60 * DAY_MS);
    const [total, multi, activeThisYear, dueSoon60, withoutManagerStudents] = await Promise.all([
      this.prisma.studentGrant.count({ where: base }),
      this.prisma.studentGrant.count({ where: { ...base, totalYears: { gt: 1 } } }),
      this.prisma.studentGrant.count({ where: { ...base, status: GrantStatus.ACTIVE } }),
      this.prisma.studentGrant.count({
        where: { ...base, status: GrantStatus.ACTIVE, nextYearStartsAt: { not: null, lte: dueSoonUpper } },
      }),
      this.prisma.studentGrant.count({
        where: {
          ...base,
          status: GrantStatus.ACTIVE,
          student: { deletedAt: null, managerId: null, chinaManagerId: null },
        },
      }),
    ]);
    return { total, multi, activeThisYear, dueSoon60, withoutManager: withoutManagerStudents };
  }

  async findOne(id: string, user: CurrentUser) {
    return this.loadForMutation(id, user);
  }

  private validateYears(totalYears: number, currentYear: number) {
    if (currentYear > totalYears) {
      throw new BadRequestException('Текущий год обучения не может быть больше общего количества лет гранта');
    }
  }

  async create(dto: CreateGrantDto, user: CurrentUser) {
    const student = await this.loadStudentForLink(dto.studentId, user);

    const totalYears = dto.totalYears;
    const currentYear = dto.currentYear ?? 1;
    this.validateYears(totalYears, currentYear);

    let startDate: Date;
    try {
      startDate = parseCalendarDate(dto.startDate);
    } catch {
      throw new BadRequestException('Некорректная дата начала обучения');
    }
    const intake = detectIntake(startDate);

    let nextYearStartsAt: Date | null;
    if (currentYear >= totalYears) {
      nextYearStartsAt = null;
    } else if (dto.nextYearStartsAt) {
      try {
        nextYearStartsAt = parseCalendarDate(dto.nextYearStartsAt);
      } catch {
        throw new BadRequestException('Некорректная дата начала следующего учебного года');
      }
    } else {
      // Фолбэк: year N+1 стартует через currentYear лет после первого года.
      nextYearStartsAt = addYears(startDate, currentYear);
    }

    const grant = await this.prisma.studentGrant.create({
      data: {
        studentId: dto.studentId,
        name: dto.name?.trim() || null,
        university: dto.university?.trim() || null,
        totalYears,
        currentYear,
        startDate,
        intake,
        nextYearStartsAt,
        status: GrantStatus.ACTIVE,
        note: dto.note?.trim() || null,
        createdById: user.id,
      },
      include: GRANT_INCLUDE,
    });

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'GRANT_CREATE',
        studentId: student.id,
        studentName: student.fullName,
        details: `Добавлен грант${grant.name ? ` «${grant.name}»` : ''}: ${totalYears} ${totalYears === 1 ? 'год' : 'лет'}, начало ${formatDateRuShort(startDate)}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(student, 'grant:updated', { id: grant.id, studentId: student.id }, { studentId: student.id });

    return grant;
  }

  /**
   * Исполнитель напоминания — та же цепочка, что у джобы (менеджер студента →
   * китайский менеджер), но с фолбэком на того, кто правит грант прямо сейчас.
   * Уволенных (soft-delete) пропускаем осознанно: TasksService на них бросает
   * NotFoundException, и правка гранта упала бы с 404 из-за побочного эффекта,
   * к которому пользователь отношения не имеет.
   */
  private async pickReminderAssignee(grant: GrantRow, user: CurrentUser): Promise<string> {
    const candidates = [grant.student.managerId, grant.student.chinaManagerId].filter((v): v is string => !!v);
    if (candidates.length) {
      const alive = await this.prisma.user.findMany({
        where: { id: { in: candidates }, deletedAt: null },
        select: { id: true },
      });
      const aliveIds = new Set(alive.map((u) => u.id));
      const found = candidates.find((cid) => aliveIds.has(cid));
      if (found) return found;
    }
    return user.id;
  }

  /** Данные для TasksService.upsertSystemTask() — та же задача, что создаёт AcademicYearReminderJob. */
  private reminderTaskInput(grant: GrantRow, assignedToId: string, startsAt: Date) {
    const n = grant.currentYear + 1; // год, который скоро начнётся
    const lines = [
      `Позвонить студенту ${grant.student.fullName} и проинформировать о начале ${ordinalYearRu(n)} года обучения по гранту.`,
    ];
    // Порядок и формулировки строк — ровно как в academic-year-reminder.job.ts:
    // описание задачи здесь ПЕРЕЗАПИСЫВАЕТСЯ целиком, и любая недостающая строка
    // (телефон) просто исчезает — задача перестаёт быть самодостаточной, менеджер
    // идёт искать номер в карточке студента.
    if (grant.student.phones.length) lines.push(`Телефон: ${grant.student.phones.join(', ')}`);
    const grantLabel = [grant.name, grant.university].filter(Boolean).join(' — ');
    if (grantLabel) lines.push(`Грант: ${grantLabel}`);
    lines.push(`Начало учебного года: ${formatDateRuShort(startsAt)}`);
    lines.push(`Год ${n} из ${grant.totalYears}`);
    return {
      title: `Новый учебный год по гранту: ${grant.student.fullName}`,
      description: lines.join('\n'),
      assignedToId,
      dueDate: new Date(
        Math.max(startsAt.getTime() - REMINDER_DUE_LEAD_MS, Date.now() + REMINDER_MIN_DUE_LEAD_MS),
      ),
      originKey: academicYearOriginKey(grant.studentId, grant.id, startsAt),
    };
  }

  async update(id: string, dto: UpdateGrantDto, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);

    const nextTotalYears = dto.totalYears ?? existing.totalYears;
    const nextCurrentYear = dto.currentYear ?? existing.currentYear;
    this.validateYears(nextTotalYears, nextCurrentYear);

    const nextStatus = dto.status ?? existing.status;

    let nextStartDate = existing.startDate;
    if (dto.startDate !== undefined) {
      try {
        nextStartDate = parseCalendarDate(dto.startDate);
      } catch {
        throw new BadRequestException('Некорректная дата начала обучения');
      }
    }
    const nextIntake = dto.startDate !== undefined ? detectIntake(nextStartDate) : existing.intake;

    let nextNextYearStartsAt: Date | null = existing.nextYearStartsAt;
    if (dto.nextYearStartsAt !== undefined) {
      if (dto.nextYearStartsAt === null) {
        nextNextYearStartsAt = null;
      } else {
        try {
          nextNextYearStartsAt = parseCalendarDate(dto.nextYearStartsAt);
        } catch {
          throw new BadRequestException('Некорректная дата начала следующего учебного года');
        }
      }
    }
    // ИНВАРИАНТ (см. schema.prisma): nextYearStartsAt IS NOT NULL ⟺
    // status = ACTIVE И currentYear < totalYears. Держим его ЗДЕСЬ, а не
    // полагаемся на то, что фронт всегда пришлёт согласованные значения.
    //
    // ОБЕ СТОРОНЫ, а не только обнуление. Раньше проверка работала в одну:
    // грант уводят в SUSPENDED (академотпуск) — дата обнуляется; возвращают
    // в ACTIVE обычным PATCH без явной даты — она остаётся null, и джоба
    // напоминаний больше НИКОГДА не подхватит этот грант. Ключевая функция
    // раздела 4 умирала молча, без единой ошибки в логах.
    const shouldHaveNextYear =
      nextStatus === GrantStatus.ACTIVE && nextCurrentYear < nextTotalYears;
    if (!shouldHaveNextYear) {
      nextNextYearStartsAt = null;
    } else if (!nextNextYearStartsAt) {
      // Грант снова активен и годы впереди есть, а плановой даты нет.
      // Восстанавливаем её от даты старта: startDate + currentYear лет.
      // Именно от startDate, а не «сегодня + год» — учебный год привязан
      // к набору вуза (сентябрь/февраль), а не к дате возврата из академа.
      // Менеджер поправит день вручную, когда вуз объявит точную дату.
      const restored = new Date(nextStartDate);
      restored.setUTCFullYear(restored.getUTCFullYear() + nextCurrentYear);
      nextNextYearStartsAt = restored;
    }

    const nextYearChanged = (existing.nextYearStartsAt?.getTime() ?? null) !== (nextNextYearStartsAt?.getTime() ?? null);
    // Волна 3, тот же баг (consultations.service.ts): перенос/обнуление
    // плановой даты без сброса reminderSentAt молча убивает напоминание —
    // джоба его больше никогда не отправит для этой строки.
    const nextReminderSentAt = nextYearChanged ? null : existing.reminderSentAt;

    const updated = await this.prisma.studentGrant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name?.trim() || null } : {}),
        ...(dto.university !== undefined ? { university: dto.university?.trim() || null } : {}),
        totalYears: nextTotalYears,
        currentYear: nextCurrentYear,
        startDate: nextStartDate,
        intake: nextIntake,
        nextYearStartsAt: nextNextYearStartsAt,
        reminderSentAt: nextReminderSentAt,
        status: nextStatus,
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
      },
      include: GRANT_INCLUDE,
    });

    // Сброса reminderSentAt выше МАЛО. originKey напоминания содержит
    // КАЛЕНДАРНЫЙ год старта (так задумано, см. комментарий в
    // academic-year-reminder.job.ts), поэтому перенос даты внутри того же года
    // ключ не меняет: джоба на следующем прогоне позовёт createSystemTask,
    // получит P2002 и вернёт СТАРУЮ (возможно уже закрытую) задачу со старой
    // датой — ни уведомления, ни верного срока менеджер не увидит. Разрыв
    // закрываем здесь, со стороны того, кто дату и меняет.
    //
    // Признак «задача уже существует» — заполненный ДО правки reminderSentAt:
    // джоба ставит его ровно в тот момент, когда создаёт задачу. Без этого
    // условия upsert породил бы задачу за годы до окна напоминания.
    if (nextYearChanged && existing.reminderSentAt && existing.nextYearStartsAt) {
      const previousKey = academicYearOriginKey(existing.studentId, existing.id, existing.nextYearStartsAt);
      const input = nextNextYearStartsAt
        ? this.reminderTaskInput(updated, await this.pickReminderAssignee(updated, user), nextNextYearStartsAt)
        : null;
      if (input && input.originKey === previousKey) {
        // Тот же ключ — задачу нужно не создавать заново, а пересинхронизировать
        // (обновит описание и срок, воскресит soft-удалённую).
        await this.tasks.upsertSystemTask(input);
        // И ВЕРНУТЬ ФЛАГ. Инвариант «reminderSentAt заполнен ⟺ задача создана»
        // держит и это условие, и гашение в remove(). Сброс выше выполнен ради
        // джобы, но задача-то осталась жива — оставив null, мы получили бы
        // состояние «флага нет, задача есть», в котором следующая правка даты
        // не погасит призрак, а remove() оставит фантомную задачу по
        // удалённому гранту. Джобе повторно отправлять нечего: задача уже
        // синхронизирована с новой датой.
        await this.prisma.studentGrant.update({
          where: { id },
          data: { reminderSentAt: existing.reminderSentAt },
        });
        updated.reminderSentAt = existing.reminderSentAt;
      } else {
        // Дата обнулена (академотпуск/завершение) или уехала в другой
        // календарный год — по старому ключу висит призрак, зовущий звонить к
        // неверной дате. Гасим, если менеджер её ещё не взял в работу; новый
        // ключ свободен, и джоба создаст по нему честно новую задачу.
        await this.tasks.softDeleteSystemTaskIfPending(previousKey);
      }
    }

    const FIELD_LABELS: Record<string, [any, any, (v: any) => string]> = {
      name: [existing.name, updated.name, (v) => v ?? '—'],
      university: [existing.university, updated.university, (v) => v ?? '—'],
      totalYears: [existing.totalYears, updated.totalYears, (v) => String(v)],
      currentYear: [existing.currentYear, updated.currentYear, (v) => String(v)],
      startDate: [existing.startDate, updated.startDate, (v) => formatDateRuShort(v)],
      nextYearStartsAt: [existing.nextYearStartsAt, updated.nextYearStartsAt, (v) => (v ? formatDateRuShort(v) : '—')],
      status: [existing.status, updated.status, (v) => String(v)],
      note: [existing.note, updated.note, (v) => v ?? '—'],
    };
    const LABEL_RU: Record<string, string> = {
      name: 'Название',
      university: 'Вуз',
      totalYears: 'Всего лет',
      currentYear: 'Текущий год',
      startDate: 'Начало обучения',
      nextYearStartsAt: 'Начало следующего года',
      status: 'Статус',
      note: 'Заметка',
    };
    const changes: string[] = [];
    for (const key of Object.keys(FIELD_LABELS)) {
      const [before, after, fmt] = FIELD_LABELS[key];
      const beforeS = fmt(before);
      const afterS = fmt(after);
      if (beforeS !== afterS) changes.push(`${LABEL_RU[key]}: ${beforeS} → ${afterS}`);
    }
    if (changes.length > 0) {
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'GRANT_UPDATE',
          studentId: updated.student.id,
          studentName: updated.student.fullName,
          details: changes.join('; '),
        })
        .catch(() => undefined);
    }
    this.realtime.emitForStudent(
      updated.student,
      'grant:updated',
      { id: updated.id, studentId: updated.student.id },
      { studentId: updated.student.id },
    );

    return updated;
  }

  /**
   * ТЗ 4 — «Перевести на следующий год». Явное действие ЧЕЛОВЕКА (менеджер
   * дозвонился и подтвердил продление) — грант никогда не продвигается сам
   * по календарю (тот же принцип, что Double Check в платежах).
   */
  async advance(id: string, dto: AdvanceGrantDto, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    // ИНВАРИАНТ schema.prisma: nextYearStartsAt IS NOT NULL ⟺ status = ACTIVE
    // И currentYear < totalYears. Проверка статуса — вторая его половина,
    // симметричная проверке на последний год ниже. Без неё перевод гранта в
    // SUSPENDED (академотпуск), TERMINATED или COMPLETED проставлял бы ему
    // плановую дату: строка попадает в реестр, но не в счётчик stats и не в
    // выборку джобы — плитка и таблица на ОДНОМ экране показывают разные
    // числа, а обещанного звонка так никто и не получает.
    if (existing.status !== GrantStatus.ACTIVE) {
      throw new ConflictException('Перевод на следующий год доступен только для действующего гранта');
    }
    if (existing.currentYear >= existing.totalYears) {
      throw new ConflictException('Грант уже на последнем году обучения');
    }

    let actualStart: Date;
    if (dto.startsAt) {
      try {
        actualStart = parseCalendarDate(dto.startsAt);
      } catch {
        throw new BadRequestException('Некорректная дата фактического начала года');
      }
    } else {
      actualStart = existing.nextYearStartsAt ?? addYears(existing.startDate, existing.currentYear);
    }

    const newCurrentYear = existing.currentYear + 1;
    // ЦЕПОЧКА, а не «startDate + N лет»: если вуз сдвинул старт этого года,
    // сдвиг обязан унаследоваться следующим годом (см. grantModel проекта архитектора).
    const newNextYearStartsAt = newCurrentYear < existing.totalYears ? addYears(actualStart, 1) : null;

    const updated = await this.prisma.studentGrant.update({
      where: { id },
      data: {
        currentYear: newCurrentYear,
        nextYearStartsAt: newNextYearStartsAt,
        reminderSentAt: null,
      },
      include: GRANT_INCLUDE,
    });

    // Задача «позвонить и проинформировать о начале учебного года» относилась
    // именно к тому году, который только что начался: перевод и есть отметка
    // «год стартовал». Если менеджер её не закрыл, она превращается в призрак
    // с прошлогодней датой — гасим по старому ключу. Новый год получит свою
    // задачу от джобы, когда подойдёт окно напоминания.
    if (existing.nextYearStartsAt) {
      await this.tasks.softDeleteSystemTaskIfPending(
        academicYearOriginKey(existing.studentId, existing.id, existing.nextYearStartsAt),
      );
    }

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'GRANT_YEAR_ADVANCE',
        studentId: updated.student.id,
        studentName: updated.student.fullName,
        details: `Переход на ${ordinalYearRu(newCurrentYear)} год обучения, год начался ${formatDateRuShort(actualStart)}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      updated.student,
      'grant:updated',
      { id: updated.id, studentId: updated.student.id },
      { studentId: updated.student.id },
    );

    return updated;
  }

  /** Soft-delete (правило проекта №1). @Roles(FOUNDER, ADMIN) — проверяется в контроллере. */
  async remove(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    await this.prisma.studentGrant.update({ where: { id }, data: { deletedAt: new Date() } });
    // Гранта в системе больше нет — автозадача «Новый учебный год» иначе в срок
    // потребует позвонить студенту про несуществующий грант (тот же призрак,
    // ради которого гашение добавлено в update(), и то же, что делает
    // consultations.service.remove()).
    //
    // По reminderSentAt здесь НЕ фильтруем: гашение должно быть безусловным.
    // Флаг живёт своей жизнью (update() его сбрасывает при переносе даты), и
    // сверка с ним давала дыру «флага нет, а задача есть» — грант удаляли, а
    // напоминание оставалось. softDeleteSystemTaskIfPending на свободный ключ
    // и так безопасный no-op, а условие «менеджер ещё не взял задачу в работу»
    // он проверяет сам.
    if (existing.nextYearStartsAt) {
      await this.tasks.softDeleteSystemTaskIfPending(
        academicYearOriginKey(existing.studentId, existing.id, existing.nextYearStartsAt),
      );
    }
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'GRANT_CLOSE',
        studentId: existing.student.id,
        studentName: existing.student.fullName,
        details: `Грант${existing.name ? ` «${existing.name}»` : ''} удалён из реестра`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      existing.student,
      'grant:updated',
      { id: existing.id, studentId: existing.student.id },
      { studentId: existing.student.id },
    );
    return { ok: true };
  }
}
