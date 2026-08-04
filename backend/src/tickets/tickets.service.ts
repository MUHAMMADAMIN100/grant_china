import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Region, Role, TicketStatus } from '@prisma/client';
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
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

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

const TICKET_INCLUDE = {
  student: { select: { id: true, fullName: true, phones: true, managerId: true, chinaManagerId: true } },
  createdBy: { select: { id: true, fullName: true } },
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
    and.push({ student: this.studentScopeWhere(user) });

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
        orderBy: { departureAt: 'desc' },
        skip,
        take: pageSize,
        include: TICKET_INCLUDE,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Сводка над таблицей: сколько вылетов впереди и сколько билетов ещё не выкуплено. */
  async stats(user: CurrentUser) {
    const base: Prisma.TicketWhereInput = { deletedAt: null, student: this.studentScopeWhere(user) };
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
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
}
