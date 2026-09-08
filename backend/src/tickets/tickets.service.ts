import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Region, Role, TicketReviewStatus, TicketStatus } from '@prisma/client';
import { containsInsensitive } from '../common/search';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { isPrivileged } from '../common/roles';
import { assignedOrFreeFilter, canAccessStudentRecord } from '../common/access';
import { normalizeCity } from '../common/china-cities';
import { phoneContainsConditions } from '../common/phone';
import { formatLocalDateTime } from '../scheduler/time';
import { TasksService } from '../tasks/tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { StudentTicketDto, StudentTicketUpdateDto } from './dto/student-ticket.dto';
import { localDayStart } from '../scheduler/time';

/**
 * ТЗ v3 р4 — регион менеджера. Необязательный: часть внутренних вызовов
 * собирает объект не из JWT, а отсутствие региона трактуется как BOTH,
 * то есть как поведение до разделения по регионам.
 */
export type CurrentUser = { id: string; role: Role; region?: Region };

/** Лёгкий контракт файла — сервис не зависит от Express/Multer типов (см. payments.service.ReceiptFileInput). */
export interface TicketFileInput {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

/** Тип Document для маршрутной квитанции. Управляется ТОЛЬКО через tickets/. */
export const TICKET_DOCUMENT_TYPE = 'TICKET';

/**
 * Ключ автозадачи «Вылет через 3 дня». ОБЯЗАН совпадать с выражением в
 * scheduler/jobs/flight-reminder.job.ts: задачу создаёт джоба, а гасит при
 * переносе/отмене/удалении рейса этот сервис — разъехавшийся формат означал бы,
 * что сервис гасит несуществующий ключ, а старая задача остаётся висеть.
 */
function flightTaskOriginKey(ticketId: string, departureAt: Date): string {
  return `flight:${ticketId}:${departureAt.getTime()}`;
}

/**
 * 26.08.2026 — билеты, которые для CRM «существуют»: заведены сотрудником
 * (reviewStatus IS NULL) либо поданы студентом и ПОДТВЕРЖДЕНЫ. Билет на
 * проверке и отклонённый в общий список, сводку и напоминания не попадают —
 * решение заказчика: слова студента не работают, пока их не проверили.
 *
 * Экспортируется ради джобы напоминаний (flight-reminder.job.ts): у неё свой
 * where, и без общей константы условие в двух местах разъехалось бы —
 * менеджер получил бы задачу «подготовить студента к вылету» по рейсу,
 * которого в его списке нет.
 */
export const LIVE_REVIEW_WHERE: Prisma.TicketWhereInput = {
  OR: [{ reviewStatus: null }, { reviewStatus: TicketReviewStatus.APPROVED }],
};

const TICKET_INCLUDE = {
  student: { select: { id: true, fullName: true, phones: true, managerId: true, chinaManagerId: true } },
  createdBy: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
  documents: {
    where: { deletedAt: null },
    select: { id: true, filename: true, originalName: true, mimeType: true, size: true, url: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.TicketInclude;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

export interface TicketListFilters {
  status?: TicketStatus;
  destinationCity?: string;
  studentId?: string;
  /**
   * Ответственный за студента — таджикский ЛИБО китайский менеджер.
   *
   * Считаем по обоим полям, а не по одному: после передачи студента в
   * китайский офис (ChinaTransferModal) за перелёт отвечает уже принимающая
   * сторона, и фильтр «по менеджеру» обязан находить билеты в обеих ролях.
   * Ровно та же формула, что в grants.service.ts.
   */
  managerId?: string;
  /**
   * 26.08.2026 — какие билеты по стадии проверки показывать.
   *  - undefined: только «живые» (LIVE_REVIEW_WHERE) — общий список раздела;
   *  - 'pending': только ожидающие подтверждения — вкладка «На подтверждении»;
   *  - 'all': всё, включая отклонённые — карточка студента, где нужна вся история.
   */
  review?: 'pending' | 'all';
  /** Диапазон по дате вылета — «на этой неделе» / «в этом месяце» / кастом. */
  from?: Date;
  to?: Date;
  /** Поиск по ФИО студента, номеру рейса (ТЗ 4.2) и телефону студента (ТЗ v3 р1). */
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Раздел «Билеты» (волна 8) — учёт и контроль перелётов студентов.
 *
 * ПРАВА (ТЗ п.2): доступ считает СЕРВИС по владению студентом —
 * canAccessStudentRecord, тот же приём, что в grants.service.ts и
 * contracts.service.ts. Менеджер видит и редактирует билеты своих студентов,
 * Администратор и Основатель — все. Удаление дополнительно сужено до
 * FOUNDER/ADMIN декоратором @Roles в контроллере (ТЗ: «Администратор: полный
 * доступ, возможность удаления»).
 *
 * УДАЛЕНИЕ — SOFT (deletedAt), как и везде в проекте: правило №1 запрещает
 * физически стирать данные. Для менеджера это неотличимо от настоящего
 * удаления (запись пропадает из всех списков), но Основатель может
 * восстановить ошибочно удалённый билет.
 */
/** Конец календарного дня по Душанбе через `days` дней от `now` (последняя миллисекунда). */
function endOfLocalDayAfter(now: Date, days: number): Date {
  return new Date(localDayStart(new Date(now.getTime() + (days + 1) * 86_400_000)).getTime() - 1);
}

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
    // Единственная зависимость модуля: автозадачу о вылете СОЗДАЁТ джоба, но
    // гасить её при переносе/отмене/удалении рейса обязан тот, кто рейс и
    // меняет. Прямой доступ к prisma.task запрещён архитектурой — только через
    // TasksService (тот же приём, что в grants.service.ts).
    private tasks: TasksService,
    // 26.08.2026 — билет от студента должен дойти до менеджера колокольчиком
    // и в Telegram. Сотрудник о своих же действиях не уведомляется.
    private notifications: NotificationsService,
  ) {}

  private parseDate(raw: string, message: string): Date {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(message);
    return d;
  }

  /** Условие видимости по студенту — идентично grants/contracts. */
  private studentScopeWhere(user: CurrentUser, extra: Prisma.StudentWhereInput[] = []): Prisma.StudentWhereInput {
    const and: Prisma.StudentWhereInput[] = [...extra];
    if (!isPrivileged(user.role)) {
      // ТЗ v3 р4 — общая формула с canAccessStudentRecord (см. common/access.ts).
      and.push({ OR: assignedOrFreeFilter(user) as Prisma.StudentWhereInput[] });
    }
    return and.length ? { deletedAt: null, AND: and } : { deletedAt: null };
  }

  /** IDOR-защита при создании: студент должен существовать и быть доступен. */
  private async loadStudentForLink(studentId: string, user: CurrentUser) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
    });
    if (!student || !canAccessStudentRecord(student, user)) throw new NotFoundException('Студент не найден');
    return student;
  }

  /** Доступ к билету (чтение И запись): 404, а не 403 — не быть оракулом существования id. */
  private async loadForMutation(id: string, user: CurrentUser): Promise<TicketRow> {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, deletedAt: null }, include: TICKET_INCLUDE });
    if (!ticket || !canAccessStudentRecord(ticket.student, user)) throw new NotFoundException('Билет не найден');
    return ticket;
  }

  private async refetch(id: string): Promise<TicketRow> {
    return this.prisma.ticket.findUniqueOrThrow({ where: { id }, include: TICKET_INCLUDE });
  }

  // ------------------------------------------------------------------
  // Чтение
  // ------------------------------------------------------------------

  async findAll(filters: TicketListFilters, user: CurrentUser) {
    const and: Prisma.TicketWhereInput[] = [];
    // 26.08.2026 — стадия проверки. По умолчанию непроверенное скрыто.
    if (filters.review === 'pending') and.push({ reviewStatus: TicketReviewStatus.PENDING });
    else if (filters.review !== 'all') and.push(LIVE_REVIEW_WHERE);
    if (filters.status) and.push({ status: filters.status });
    if (filters.studentId) and.push({ studentId: filters.studentId });
    if (filters.destinationCity) {
      // Точное совпадение по нормализованному городу: фильтр — это выбор из
      // списка, а не поиск. Регистр игнорируем на случай ручного ввода.
      and.push({ destinationCity: { equals: normalizeCity(filters.destinationCity), mode: 'insensitive' } });
    }
    if (filters.from || filters.to) {
      const departureAt: Prisma.DateTimeFilter = {};
      if (filters.from) departureAt.gte = filters.from;
      if (filters.to) departureAt.lte = filters.to;
      and.push({ departureAt });
    }
    // ТЗ 4.2: «Поиск по тексту: ФИО студента, номер рейса» — одно поле, два
    // источника. Поиск по ФИО идёт через relation, поэтому он НЕ может жить
    // в том же ключе `student`, что и scope-условие ниже (Prisma не допускает
    // два разных условия на одно relation-поле объекта) — кладём его в OR.
    if (filters.search) {
      // ТЗ v3 раздел 1 — телефон студента ищется здесь же, одной строкой
      // поиска. Ищем по денормализованному Student.phoneSearch: там для
      // КАЖДОГО номера студента лежат обе формы записи — с кодом страны и без
      // (см. buildPhoneSearch в common/phone.ts), поэтому достаточно сравнить
      // с ним цифры запроса, и «+992 90 123-45-67», «992901234567» и
      // «901234567» находят одну и ту же карточку.
      //
      // Вариантов запроса ДВА: цифры как есть и национальная форма без кода
      // страны. Одной формы не хватает — сам номер тоже могли записать как с
      // кодом, так и без (разбор в phoneContainsConditions).
      //
      // При поиске по ФИО («Иванов») цифр нет, функция возвращает пустой
      // массив, и условие не добавляется вовсе: `contains: ''` совпал бы с
      // каждым студентом с заполненным телефоном и показал бы все билеты.
      const or: Prisma.TicketWhereInput[] = [
        { flightNumber: containsInsensitive(filters.search) },
        { airline: containsInsensitive(filters.search) },
        { student: { fullName: containsInsensitive(filters.search) } },
      ];
      // Отдельной веткой OR, а не внутри объекта student выше: Prisma не
      // допускает два разных условия на одно relation-поле одного объекта
      // (та же причина, по которой поиск по ФИО не живёт в ключе scope ниже).
      for (const cond of phoneContainsConditions('phoneSearch', filters.search)) {
        or.push({ student: cond });
      }
      and.push({ OR: or });
    }
    // Условия по студенту складываются в ОДИН ключ `student` вместе со
    // scope-условием: Prisma не допускает двух разных условий на одно
    // relation-поле объекта — отдельный `and.push({ student: {...} })` рядом
    // с scope молча перетёр бы проверку доступа. Для того studentScopeWhere и
    // принимает extra (та же схема, что в grants.service.ts).
    const studentExtra: Prisma.StudentWhereInput[] = [];
    if (filters.managerId) {
      studentExtra.push({
        OR: [{ managerId: filters.managerId }, { chinaManagerId: filters.managerId }],
      });
    }
    and.push({ student: this.studentScopeWhere(user, studentExtra) });

    const where: Prisma.TicketWhereInput = { deletedAt: null, AND: and };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        // Самые поздние вылеты сверху, состоявшиеся рейсы уходят вниз — тот же
        // порядок «свежее сверху», что во всех списках CRM.
        //
        // Задачу «кто летит на этой неделе» решают не сортировкой, а фильтром
        // периода из ТЗ 4.2 и колонкой «через N дн.»: разворачивать порядок в
        // зависимости от выбранного фильтра значило бы менять поведение списка
        // под пользователем без его ведома.
        // Очередь на подтверждение — в порядке подачи: кто раньше прислал,
        // того раньше и проверят. Остальным спискам — «свежее сверху».
        orderBy: filters.review === 'pending' ? { submittedByStudentAt: 'asc' } : { departureAt: 'desc' },
        skip,
        take: pageSize,
        include: TICKET_INCLUDE,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Счётчик вкладки «На подтверждении» — в объёме видимости пользователя. */
  async pendingCount(user: CurrentUser) {
    const count = await this.prisma.ticket.count({
      where: { deletedAt: null, reviewStatus: TicketReviewStatus.PENDING, student: this.studentScopeWhere(user) },
    });
    return { count };
  }

  /** Сводка над таблицей: сколько вылетов впереди и сколько билетов ещё не выкуплено. */
  async stats(user: CurrentUser) {
    // LIVE_REVIEW_WHERE и здесь: «Вылет ≤ 7 дней» не должен считать рейс,
    // которого в таблице под сводкой нет.
    const base: Prisma.TicketWhereInput = { deletedAt: null, ...LIVE_REVIEW_WHERE, student: this.studentScopeWhere(user) };
    const now = new Date();
    // 08.09.2026 — окно до КОНЦА седьмого/тридцатого календарного дня по
    // Душанбе, а не «ровно 7 × 24 ч от текущей секунды». Подпись в таблице
    // считает календарные дни («через 7 дн.» у рейса 15.09 23:00 при
    // сегодняшнем 08.09), и плитка «Вылет ≤ 7 дней» обязана считать его же.
    const in7 = endOfLocalDayAfter(now, 7);
    const in30 = endOfLocalDayAfter(now, 30);
    const [total, upcoming7, upcoming30, booked, cancelled] = await Promise.all([
      this.prisma.ticket.count({ where: base }),
      this.prisma.ticket.count({
        where: { ...base, status: { not: 'CANCELLED' }, departureAt: { gte: now, lte: in7 } },
      }),
      this.prisma.ticket.count({
        where: { ...base, status: { not: 'CANCELLED' }, departureAt: { gte: now, lte: in30 } },
      }),
      // «Забронирован, но не выкуплен» и вылет уже впереди — главный риск раздела.
      this.prisma.ticket.count({ where: { ...base, status: 'BOOKED', departureAt: { gte: now } } }),
      this.prisma.ticket.count({ where: { ...base, status: 'CANCELLED' } }),
    ]);
    return { total, upcoming7, upcoming30, booked, cancelled };
  }

  async findOne(id: string, user: CurrentUser) {
    return this.loadForMutation(id, user);
  }

  // ------------------------------------------------------------------
  // Запись
  // ------------------------------------------------------------------

  async create(dto: CreateTicketDto, file: TicketFileInput | undefined, user: CurrentUser) {
    const student = await this.loadStudentForLink(dto.studentId, user);

    const departureAt = this.parseDate(dto.departureAt, 'Некорректная дата вылета');
    const arrivalAt = dto.arrivalAt ? this.parseDate(dto.arrivalAt, 'Некорректная дата прилёта') : null;
    // Прилёт раньше вылета — всегда ошибка ввода (перепутали поля местами).
    // Проверяем здесь, а не в DTO: class-validator не умеет сравнивать два поля
    // без кастомного декоратора, а сообщение должно быть человеческим.
    if (arrivalAt && arrivalAt.getTime() < departureAt.getTime()) {
      throw new BadRequestException('Дата прилёта не может быть раньше даты вылета');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          studentId: dto.studentId,
          destinationCity: normalizeCity(dto.destinationCity),
          departureAt,
          arrivalAt,
          flightNumber: dto.flightNumber.trim(),
          airline: dto.airline?.trim() || null,
          status: dto.status ?? 'BOOKED',
          comment: dto.comment?.trim() || null,
          createdById: user.id,
        },
        select: { id: true },
      });
      if (file) {
        // Маршрутная квитанция — обычный Document, привязанный И к студенту
        // (отсюда бесплатная защита /uploads), И к билету. Тот же приём, что
        // у чеков платежей и сканов договоров.
        await tx.document.create({
          data: {
            studentId: dto.studentId,
            ticketId: ticket.id,
            type: TICKET_DOCUMENT_TYPE,
            filename: file.filename,
            originalName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            url: file.url,
          },
        });
      }
      return ticket;
    });

    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'TICKET_CREATE',
        studentId: student.id,
        studentName: student.fullName,
        // Время вылета — ТОЛЬКО через formatLocalDateTime: на сервере TZ=UTC,
        // и голое toLocaleString напечатало бы вылет на 5 часов раньше
        // реального. Джоба напоминаний форматирует ту же дату этим хелпером —
        // без него одна и та же дата печаталась бы в системе двумя разными
        // числами, и журнал спорил бы с текстом автозадачи и SMS студенту.
        details: `Билет ${dto.flightNumber.trim()} → ${normalizeCity(dto.destinationCity)}, вылет ${formatLocalDateTime(departureAt, true)}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(student, 'ticket:updated', { id: created.id, studentId: student.id }, { studentId: student.id });

    return this.refetch(created.id);
  }

  async update(id: string, dto: UpdateTicketDto, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);

    const data: Prisma.TicketUpdateInput = {};
    const changes: string[] = [];

    if (dto.destinationCity !== undefined) {
      const city = normalizeCity(dto.destinationCity);
      if (city !== existing.destinationCity) changes.push(`Город: ${existing.destinationCity} → ${city}`);
      data.destinationCity = city;
    }
    if (dto.flightNumber !== undefined) {
      const flight = dto.flightNumber.trim();
      if (flight !== existing.flightNumber) changes.push(`Рейс: ${existing.flightNumber} → ${flight}`);
      data.flightNumber = flight;
    }
    if (dto.airline !== undefined) data.airline = dto.airline?.trim() || null;
    const nextStatus = dto.status ?? existing.status;
    if (dto.status !== undefined && dto.status !== existing.status) {
      changes.push(`Статус: ${existing.status} → ${dto.status}`);
      data.status = dto.status;
    } else if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.comment !== undefined) data.comment = dto.comment?.trim() || null;

    // Пустая строка = «стереть дату прилёта». @IsISO8601 не пропускает null,
    // поэтому договорённость с фронтом — пустая строка (см. UpdateTicketDto).
    let nextArrivalAt = existing.arrivalAt;
    if (dto.arrivalAt !== undefined) {
      nextArrivalAt = dto.arrivalAt ? this.parseDate(dto.arrivalAt, 'Некорректная дата прилёта') : null;
      data.arrivalAt = nextArrivalAt;
    }

    let departureChanged = false;
    let nextDepartureAt = existing.departureAt;
    if (dto.departureAt !== undefined) {
      nextDepartureAt = this.parseDate(dto.departureAt, 'Некорректная дата вылета');
      departureChanged = nextDepartureAt.getTime() !== existing.departureAt.getTime();
      if (departureChanged) {
        // formatLocalDateTime, а не toLocaleString — см. комментарий в create():
        // сервер живёт в UTC, голый toLocaleString сдвигает вылет на 5 часов.
        changes.push(
          `Вылет: ${formatLocalDateTime(existing.departureAt, true)} → ${formatLocalDateTime(nextDepartureAt, true)}`,
        );
      }
      data.departureAt = nextDepartureAt;
    }

    // Сверяем ИТОГОВЫЕ значения, а не только присланные: PATCH может менять
    // одну дату из пары, и тогда проверка «только если пришёл departureAt»
    // пропустила бы прилёт, назначенный раньше вылета.
    if (nextArrivalAt && nextArrivalAt.getTime() < nextDepartureAt.getTime()) {
      throw new BadRequestException('Дата прилёта не может быть раньше даты вылета');
    }

    // ПЕРЕНОС РЕЙСА = НОВЫЙ ЦИКЛ НАПОМИНАНИЙ. Ровно та же ошибка, что была
    // допущена и исправлена в волне 3 с переносом повторного звонка: джоба
    // выбирает кандидатов строго по `taskCreatedAt: null` / `smsSentAt: null`
    // и занимает строку НАВСЕГДА. Без сброса флагов перенос вылета на неделю
    // вперёд означал бы, что напоминание по новому сроку не придёт никогда —
    // молча, без единой ошибки в логах.
    //
    // Работает это в паре с originKey задачи, куда входит момент вылета
    // (flight-reminder.job.ts): сам по себе сброс флага холост — джоба
    // упиралась бы в занятый ключ и возвращала старую задачу.
    if (departureChanged) {
      data.taskCreatedAt = null;
      data.smsSentAt = null;
    }

    // 26.08.2026 — сотрудник тронул билет, поданный студентом. С этого момента
    // пометка «данные внёс студент» в списке снимается (проверенные данные —
    // уже не слова студента), а студенту правка закрывается: иначе он мог бы
    // затереть исправление менеджера (решение заказчика).
    if (existing.submittedByStudentAt && !existing.staffEditedAt) {
      data.staffEditedAt = new Date();
    }

    // ВОЗВРАТ ИЗ ОТМЕНЫ = ТОЖЕ НОВЫЙ ЦИКЛ. При отмене мы гасим задачу о вылете
    // (см. ниже), но флаг taskCreatedAt остаётся заполненным. Если менеджер
    // отменил билет по ошибке и вернул статус обратно, джоба такой билет уже
    // не подхватит — она выбирает строго по `taskCreatedAt: null`, — и
    // напоминание пропадёт навсегда, молча. Причём SMS студенту при этом
    // уйдёт (smsSentAt не трогали), то есть студенту напомнят, а
    // ответственному нет. Сбрасываем оба флага, чтобы цикл начался заново.
    const revivedFromCancelled = existing.status === TicketStatus.CANCELLED && nextStatus !== TicketStatus.CANCELLED;
    if (revivedFromCancelled) {
      data.taskCreatedAt = null;
      data.smsSentAt = null;
    }

    await this.prisma.ticket.update({ where: { id }, data });

    // Сброса флагов выше МАЛО. В originKey задачи входит момент вылета, поэтому
    // после переноса джоба создаёт НОВУЮ задачу, а старая никуда не девается:
    // у менеджера две одноимённые задачи по одному билету с противоречащими
    // датами, и первая вечно висит в «Просроченных», требуя готовить студента к
    // рейсу, которого не будет. Гасим её здесь — тем же приёмом, что
    // GrantsService при переносе учебного года.
    const staleTaskKeys = new Set<string>();
    if (departureChanged) staleTaskKeys.add(flightTaskOriginKey(id, existing.departureAt));
    // Отменённый рейс джоба больше не подхватит, но задача, созданная ДО
    // отмены, сама не исчезнет — и требует готовить студента к вылету,
    // которого не будет. Ключ считаем по ИТОГОВОЙ дате: при одновременном
    // переносе и отмене старый ключ уже добавлен строкой выше.
    if (nextStatus === TicketStatus.CANCELLED && existing.status !== TicketStatus.CANCELLED) {
      staleTaskKeys.add(flightTaskOriginKey(id, nextDepartureAt));
    }
    for (const key of staleTaskKeys) {
      await this.tasks.softDeleteSystemTaskIfPending(key);
    }

    if (changes.length) {
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'TICKET_UPDATE',
          studentId: existing.studentId,
          studentName: existing.student.fullName,
          details: changes.join('; '),
        })
        .catch(() => undefined);
    }
    this.realtime.emitForStudent(
      existing.student,
      'ticket:updated',
      { id, studentId: existing.studentId },
      { studentId: existing.studentId },
    );

    return this.refetch(id);
  }

  /** Soft-delete. @Roles(FOUNDER, ADMIN) проверяется в контроллере (ТЗ п.2). */
  async remove(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    await this.prisma.ticket.update({ where: { id }, data: { deletedAt: new Date() } });
    // Билета больше нет — фантомная задача «проверить готовность к вылету»
    // тем более неуместна (то же, что consultations.service.remove() делает со
    // своей автозадачей). Гасим только не взятую в работу — решение по уже
    // начатой остаётся за менеджером.
    await this.tasks.softDeleteSystemTaskIfPending(flightTaskOriginKey(id, existing.departureAt));
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'TICKET_DELETE',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details: `Удалён билет ${existing.flightNumber} → ${existing.destinationCity}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      existing.student,
      'ticket:updated',
      { id, studentId: existing.studentId },
      { studentId: existing.studentId },
    );
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Файлы (маршрутная квитанция)
  // ------------------------------------------------------------------

  async addDocument(id: string, file: TicketFileInput | undefined, user: CurrentUser) {
    if (!file) throw new BadRequestException('Файл не передан');
    const ticket = await this.loadForMutation(id, user);
    const doc = await this.prisma.document.create({
      data: {
        studentId: ticket.studentId,
        ticketId: id,
        type: TICKET_DOCUMENT_TYPE,
        filename: file.filename,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        url: file.url,
      },
    });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'TICKET_UPDATE',
        studentId: ticket.studentId,
        studentName: ticket.student.fullName,
        details: `Прикреплена маршрутная квитанция к билету ${ticket.flightNumber}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      ticket.student,
      'ticket:updated',
      { id, studentId: ticket.studentId },
      { studentId: ticket.studentId },
    );
    return doc;
  }

  async removeDocument(docId: string, user: CurrentUser) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, deletedAt: null, ticketId: { not: null } },
      include: { ticket: { include: TICKET_INCLUDE } },
    });
    // 404 в обоих случаях (нет документа / нет прав) — не быть оракулом
    // существования, как в payments.removeReceipt.
    if (!doc || !doc.ticket || !canAccessStudentRecord(doc.ticket.student, user)) {
      throw new NotFoundException('Файл билета не найден');
    }
    await this.prisma.document.update({ where: { id: docId }, data: { deletedAt: new Date() } });
    this.realtime.emitForStudent(
      doc.ticket.student,
      'ticket:updated',
      { id: doc.ticket.id, studentId: doc.ticket.studentId },
      { studentId: doc.ticket.studentId },
    );
    return { ok: true };
  }
  // ------------------------------------------------------------------
  // 26.08.2026 — проверка билетов, поданных студентом (сторона CRM)
  // ------------------------------------------------------------------

  /** Билет должен ждать проверки — иначе принять/отклонить нечего. */
  private assertPending(ticket: TicketRow): void {
    if (ticket.reviewStatus !== TicketReviewStatus.PENDING) {
      throw new BadRequestException(
        ticket.reviewStatus === TicketReviewStatus.APPROVED
          ? 'Этот билет уже подтверждён'
          : ticket.reviewStatus === TicketReviewStatus.REJECTED
            ? 'Этот билет уже отклонён'
            : 'Этот билет завёл сотрудник — подтверждать нечего',
      );
    }
  }

  /**
   * Принять билет студента. После этого запись ничем не отличается от
   * заведённой сотрудником: попадает в общий список, сводку, напоминания.
   * Уведомление в CRM не шлём — сотрудник и есть автор действия; студент
   * узнаёт из кабинета по realtime-событию.
   */
  async approve(id: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    this.assertPending(existing);
    await this.prisma.ticket.update({
      where: { id },
      data: {
        reviewStatus: TicketReviewStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedById: user.id,
        reviewNote: null,
      },
    });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'TICKET_APPROVE',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details: `Подтверждён билет студента ${existing.flightNumber} → ${existing.destinationCity}, вылет ${formatLocalDateTime(existing.departureAt, true)}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      existing.student,
      'ticket:updated',
      { id, studentId: existing.studentId },
      { studentId: existing.studentId },
    );
    return this.refetch(id);
  }

  /** Отклонить с причиной. Студент видит причину в кабинете и может подать заново. */
  async reject(id: string, reason: string, user: CurrentUser) {
    const existing = await this.loadForMutation(id, user);
    this.assertPending(existing);
    const note = reason.trim();
    await this.prisma.ticket.update({
      where: { id },
      data: {
        reviewStatus: TicketReviewStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedById: user.id,
        reviewNote: note,
      },
    });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'TICKET_REJECT',
        studentId: existing.studentId,
        studentName: existing.student.fullName,
        details: `Отклонён билет студента ${existing.flightNumber} → ${existing.destinationCity}: ${note}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      existing.student,
      'ticket:updated',
      { id, studentId: existing.studentId },
      { studentId: existing.studentId },
    );
    return this.refetch(id);
  }

  // ------------------------------------------------------------------
  // 26.08.2026 — сторона СТУДЕНТА (личный кабинет, /student-auth/tickets)
  // ------------------------------------------------------------------

  /**
   * Что студент видит о своём билете. Без url файла: файлы билетов входят в
   * STUDENT_RESTRICTED_DOC_TYPES (common/access.ts), /uploads их студенту
   * не отдаёт — а ссылка, которая ведёт в 403, хуже её отсутствия. Имя и
   * размер показываем: студент видит, что файл прикреплён и какой.
   */
  private static readonly STUDENT_TICKET_SELECT = {
    id: true,
    destinationCity: true,
    departureAt: true,
    arrivalAt: true,
    flightNumber: true,
    airline: true,
    status: true,
    comment: true,
    submittedByStudentAt: true,
    reviewStatus: true,
    reviewedAt: true,
    reviewNote: true,
    staffEditedAt: true,
    createdAt: true,
    updatedAt: true,
    documents: {
      where: { deletedAt: null },
      select: { id: true, originalName: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' as const },
    },
  } satisfies Prisma.TicketSelect;

  private async loadOwnStudent(studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true, fullName: true, managerId: true, chinaManagerId: true },
    });
    if (!student) throw new NotFoundException('Студент не найден');
    return student;
  }

  /**
   * Свой билет, который ещё МОЖНО править: на проверке и не тронут
   * сотрудником. Одна проверка на редактирование, отзыв и файлы — чтобы три
   * места не разошлись в том, когда студент теряет право на правку.
   * 404 на чужой id: не быть оракулом существования билета.
   */
  private async loadOwnEditable(studentId: string, id: string): Promise<TicketRow> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, studentId, deletedAt: null },
      include: TICKET_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Билет не найден');
    if (ticket.reviewStatus !== TicketReviewStatus.PENDING) {
      throw new ForbiddenException(
        ticket.reviewStatus === TicketReviewStatus.APPROVED
          ? 'Билет уже подтверждён менеджером — изменения теперь только через него'
          : ticket.reviewStatus === TicketReviewStatus.REJECTED
            ? 'Этот билет отклонён. Подайте новый'
            : 'Этот билет завёл менеджер — изменения только через него',
      );
    }
    if (ticket.staffEditedAt) {
      throw new ForbiddenException('Менеджер уже правил этот билет — дальнейшие изменения только через него');
    }
    return ticket;
  }

  /** Все свои билеты, включая ожидающие и отклонённые — студенту нужна вся история. */
  async listForStudent(studentId: string) {
    const items = await this.prisma.ticket.findMany({
      where: { studentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: TicketsService.STUDENT_TICKET_SELECT,
    });
    // Решение заказчика: один ожидающий билет за раз. Фронту нужен готовый
    // ответ «можно ли подать ещё», а не вычисление по списку.
    const pending = items.find((t) => t.reviewStatus === TicketReviewStatus.PENDING) ?? null;
    return { items, pendingId: pending?.id ?? null };
  }

  private studentTicketSummary(t: { flightNumber: string; destinationCity: string; departureAt: Date }): string {
    return `рейс ${t.flightNumber} → ${t.destinationCity}, вылет ${formatLocalDateTime(t.departureAt, true)}`;
  }

  /** Подача билета из кабинета: сразу на проверку, в общий список не попадает. */
  async createByStudent(studentId: string, dto: StudentTicketDto, file: TicketFileInput | undefined) {
    const student = await this.loadOwnStudent(studentId);

    // Один ожидающий за раз — защита от дублей «нажал дважды». Второй билет
    // подаётся после решения менеджера по первому.
    const pendingExists = await this.prisma.ticket.count({
      where: { studentId, deletedAt: null, reviewStatus: TicketReviewStatus.PENDING },
    });
    if (pendingExists > 0) {
      throw new ConflictException('У вас уже есть билет на проверке — дождитесь решения менеджера или измените его');
    }

    const departureAt = this.parseDate(dto.departureAt, 'Некорректная дата вылета');
    const arrivalAt = dto.arrivalAt ? this.parseDate(dto.arrivalAt, 'Некорректная дата прилёта') : null;
    if (arrivalAt && arrivalAt.getTime() < departureAt.getTime()) {
      throw new BadRequestException('Дата прилёта не может быть раньше даты вылета');
    }
    const city = normalizeCity(dto.destinationCity);
    const flight = dto.flightNumber.trim();

    const created = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          studentId,
          destinationCity: city,
          departureAt,
          arrivalAt,
          flightNumber: flight,
          airline: dto.airline?.trim() || null,
          status: dto.status ?? 'PURCHASED',
          comment: dto.comment?.trim() || null,
          // createdById пуст намеренно: это не сотрудник. Кто подал — видно
          // по submittedByStudentAt.
          createdById: null,
          submittedByStudentAt: new Date(),
          reviewStatus: TicketReviewStatus.PENDING,
        },
        select: { id: true },
      });
      if (file) {
        await tx.document.create({
          data: {
            studentId,
            ticketId: ticket.id,
            type: TICKET_DOCUMENT_TYPE,
            filename: file.filename,
            originalName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            url: file.url,
          },
        });
      }
      return ticket;
    });

    const summary = this.studentTicketSummary({ flightNumber: flight, destinationCity: city, departureAt });
    this.activity
      .log({
        actorId: null,
        actorName: student.fullName,
        actorRole: 'STUDENT',
        action: 'TICKET_STUDENT_SUBMIT',
        studentId,
        studentName: student.fullName,
        details: `Студент добавил билет: ${summary}${file ? ' (с файлом)' : ''}`,
      })
      .catch(() => undefined);
    // notifyForStudent — менеджеры студента + Основатель/Администратор,
    // колокольчик и Telegram (решение заказчика: все четыре канала).
    this.notifications
      .notifyForStudent(student, {
        type: 'TICKET_STUDENT_SUBMIT',
        title: 'Студент добавил билет',
        message: `${student.fullName}: ${summary}. Ждёт подтверждения.`,
        payload: { studentId, ticketId: created.id },
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(student, 'ticket:updated', { id: created.id, studentId }, { studentId });

    return this.prisma.ticket.findUnique({ where: { id: created.id }, select: TicketsService.STUDENT_TICKET_SELECT });
  }

  async updateByStudent(studentId: string, id: string, dto: StudentTicketUpdateDto) {
    const existing = await this.loadOwnEditable(studentId, id);
    const data: Prisma.TicketUpdateInput = {};
    const changes: string[] = [];

    if (dto.destinationCity !== undefined) {
      const city = normalizeCity(dto.destinationCity);
      if (city !== existing.destinationCity) changes.push(`Город: ${existing.destinationCity} → ${city}`);
      data.destinationCity = city;
    }
    if (dto.flightNumber !== undefined) {
      const flight = dto.flightNumber.trim();
      if (flight !== existing.flightNumber) changes.push(`Рейс: ${existing.flightNumber} → ${flight}`);
      data.flightNumber = flight;
    }
    // В отличие от правки сотрудником, здесь в журнал и уведомление идёт
    // ЛЮБОЕ изменённое поле, включая авиакомпанию, прилёт и комментарий:
    // менеджер проверяет данные студента целиком, и правка «мелочи» после
    // того, как он уже смотрел заявку, — ровно то, о чём его надо предупредить.
    if (dto.airline !== undefined) {
      const airline = dto.airline?.trim() || null;
      if (airline !== existing.airline) changes.push(`Авиакомпания: ${existing.airline ?? '—'} → ${airline ?? '—'}`);
      data.airline = airline;
    }
    if (dto.status !== undefined) {
      if (dto.status !== existing.status) changes.push(`Статус: ${existing.status} → ${dto.status}`);
      data.status = dto.status;
    }
    if (dto.comment !== undefined) {
      const comment = dto.comment?.trim() || null;
      if (comment !== existing.comment) changes.push(comment ? `Комментарий: ${comment}` : 'Комментарий удалён');
      data.comment = comment;
    }

    let nextArrivalAt = existing.arrivalAt;
    if (dto.arrivalAt !== undefined) {
      nextArrivalAt = dto.arrivalAt ? this.parseDate(dto.arrivalAt, 'Некорректная дата прилёта') : null;
      if ((nextArrivalAt?.getTime() ?? null) !== (existing.arrivalAt?.getTime() ?? null)) {
        changes.push(
          `Прилёт: ${existing.arrivalAt ? formatLocalDateTime(existing.arrivalAt, true) : '—'} → ${nextArrivalAt ? formatLocalDateTime(nextArrivalAt, true) : '—'}`,
        );
      }
      data.arrivalAt = nextArrivalAt;
    }
    let nextDepartureAt = existing.departureAt;
    if (dto.departureAt !== undefined) {
      nextDepartureAt = this.parseDate(dto.departureAt, 'Некорректная дата вылета');
      if (nextDepartureAt.getTime() !== existing.departureAt.getTime()) {
        changes.push(
          `Вылет: ${formatLocalDateTime(existing.departureAt, true)} → ${formatLocalDateTime(nextDepartureAt, true)}`,
        );
      }
      data.departureAt = nextDepartureAt;
    }
    if (nextArrivalAt && nextArrivalAt.getTime() < nextDepartureAt.getTime()) {
      throw new BadRequestException('Дата прилёта не может быть раньше даты вылета');
    }

    await this.prisma.ticket.update({ where: { id }, data });

    if (changes.length) {
      const details = changes.join('; ');
      this.activity
        .log({
          actorId: null,
          actorName: existing.student.fullName,
          actorRole: 'STUDENT',
          action: 'TICKET_STUDENT_UPDATE',
          studentId,
          studentName: existing.student.fullName,
          details: `Студент изменил билет ${existing.flightNumber}: ${details}`,
        })
        .catch(() => undefined);
      // Менеджеру важно знать, что данные поменялись ПОСЛЕ того, как он мог их
      // уже смотреть — иначе он подтвердит не то, что видел.
      this.notifications
        .notifyForStudent(existing.student, {
          type: 'TICKET_STUDENT_UPDATE',
          title: 'Студент изменил билет на проверке',
          message: `${existing.student.fullName}: ${details}`,
          payload: { studentId, ticketId: id },
        })
        .catch(() => undefined);
    }
    this.realtime.emitForStudent(existing.student, 'ticket:updated', { id, studentId }, { studentId });

    return this.prisma.ticket.findUnique({ where: { id }, select: TicketsService.STUDENT_TICKET_SELECT });
  }

  /** Отзыв заявки — soft-delete, как всё в проекте. Менеджер больше её не видит. */
  async withdrawByStudent(studentId: string, id: string) {
    const existing = await this.loadOwnEditable(studentId, id);
    await this.prisma.ticket.update({ where: { id }, data: { deletedAt: new Date() } });
    const summary = this.studentTicketSummary(existing);
    this.activity
      .log({
        actorId: null,
        actorName: existing.student.fullName,
        actorRole: 'STUDENT',
        action: 'TICKET_STUDENT_WITHDRAW',
        studentId,
        studentName: existing.student.fullName,
        details: `Студент отозвал билет: ${summary}`,
      })
      .catch(() => undefined);
    this.notifications
      .notifyForStudent(existing.student, {
        type: 'TICKET_STUDENT_WITHDRAW',
        title: 'Студент отозвал билет',
        message: `${existing.student.fullName}: ${summary} — проверять больше не нужно.`,
        payload: { studentId },
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(existing.student, 'ticket:updated', { id, studentId }, { studentId });
    return { ok: true };
  }

  /**
   * Файл к своему билету на проверке. Один файл на билет: новый ЗАМЕНЯЕТ
   * старый (старый — soft-delete), чтобы менеджер не выбирал между двумя
   * квитанциями, какая настоящая.
   */
  async addDocumentByStudent(studentId: string, id: string, file: TicketFileInput | undefined) {
    if (!file) throw new BadRequestException('Файл не передан');
    const existing = await this.loadOwnEditable(studentId, id);
    const doc = await this.prisma.$transaction(async (tx) => {
      await tx.document.updateMany({
        where: { ticketId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return tx.document.create({
        data: {
          studentId,
          ticketId: id,
          type: TICKET_DOCUMENT_TYPE,
          filename: file.filename,
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          url: file.url,
        },
        select: { id: true, originalName: true, size: true, createdAt: true },
      });
    });
    this.activity
      .log({
        actorId: null,
        actorName: existing.student.fullName,
        actorRole: 'STUDENT',
        action: 'TICKET_STUDENT_UPDATE',
        studentId,
        studentName: existing.student.fullName,
        details: `Студент прикрепил файл к билету ${existing.flightNumber}: ${file.originalName}`,
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(existing.student, 'ticket:updated', { id, studentId }, { studentId });
    return doc;
  }

  async removeDocumentByStudent(studentId: string, id: string, docId: string) {
    const existing = await this.loadOwnEditable(studentId, id);
    const doc = await this.prisma.document.findFirst({ where: { id: docId, ticketId: id, deletedAt: null } });
    if (!doc) throw new NotFoundException('Файл билета не найден');
    await this.prisma.document.update({ where: { id: docId }, data: { deletedAt: new Date() } });
    this.realtime.emitForStudent(existing.student, 'ticket:updated', { id, studentId }, { studentId });
    return { ok: true };
  }
}
