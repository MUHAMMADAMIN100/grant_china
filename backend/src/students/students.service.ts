import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Direction, Prisma, Region, Role, StudentStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isPrivileged } from '../common/roles';
import { assignedToUserFilter, canAccessStudentRecord } from '../common/access';
import { buildPhoneSearch, phoneQuery } from '../common/phone';
import { STUDENT_SAFE_FIELDS } from '../common/student-fields';
import { MANAGED_DOCUMENT_TYPES, REQUIRED_DOCUMENT_TYPES, assertNotManagedDocument } from '../common/documents';
import { invalidateStudentCache } from '../student-auth/student-jwt.guard';
import { FileResolverService } from '../files/file-resolver.service';
import { normalizePhone } from '../common/phone';
import { normalizeSource } from '../common/lead-source';
import { findRepeatOfId } from '../common/application-repeat';

function generatePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const CABINET_BY_DIRECTION: Record<Direction, number> = {
  BACHELOR: 1,
  MASTER: 2,
  LANGUAGE: 3,
  LANGUAGE_COLLEGE: 4,
  LANGUAGE_BACHELOR: 5,
  COLLEGE: 6,
};

// Soft-delete: не подтягиваем удалённые документы/заявки.
// Полный select — для карточки студента (detail). Возвращает всё, кроме password.
const STUDENT_SELECT = {
  ...STUDENT_SAFE_FIELDS,
  // MANAGED_DOCUMENT_TYPES — чеки платежей (payments/) и файлы билетов
  // (tickets/): это Document, но принадлежат своим разделам, а не чек-листу
  // документов студента. Они показываются внутри карточки платежа и карточки
  // билета, но не в чек-листе, не в счётчике и не в ZIP-архиве
  // DocumentsChecklist.tsx (см. риск волны 2).
  documents: { where: { deletedAt: null, type: { notIn: MANAGED_DOCUMENT_TYPES } } },
  manager: { select: { id: true, fullName: true, email: true } },
  chinaManager: { select: { id: true, fullName: true, email: true } },
  program: true,
  applications: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

// Облегчённый select для СПИСКА студентов в CRM-таблице.
// Не грузим documents (по 5+ файлов на студента — для списка не нужны).
// Из applications берём только id+status+createdAt последней заявки,
// чтобы UI мог показать «этап» в badge и фильтровать по stageFilter.
// На 80 студентов это уменьшает payload с ~500КБ до ~30КБ.
const STUDENT_LIST_SELECT = {
  ...STUDENT_SAFE_FIELDS,
  manager: { select: { id: true, fullName: true } },
  chinaManager: { select: { id: true, fullName: true } },
  applications: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { id: true, status: true, createdAt: true },
  },
} as const;

// Раздел 6.3 ТЗ (волна 4): человекочитаемые подписи для DOCUMENT_UPLOAD/
// DOCUMENT_DELETE в журнале активности. Не экспортируется — узкий локальный
// справочник, единственный источник значений остаётся common/documents.ts.
const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(REQUIRED_DOCUMENT_TYPES.map((d) => [d.type, d.label])),
  OTHER: 'Другое',
};

type CurrentUser = { id: string; role: Role };

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private activity: ActivityService,
    private notifications: NotificationsService,
    private fileResolver: FileResolverService,
  ) {}

  /**
   * Единая проверка доступа к карточке студента: используется и для чтения
   * (findOne — БАГ 2 аудита: раньше EMPLOYEE мог прочитать чужую карточку,
   * зная UUID), и для записи (ensureCanEdit). Правило одно и то же:
   *  - FOUNDER и ADMIN видят/редактируют всех;
   *  - EMPLOYEE — только назначенных лично ему (managerId/chinaManagerId),
   *    либо ещё никому не назначенных («свободных» — их может взять любой).
   */
  private hasAccess(
    student: { managerId: string | null; chinaManagerId?: string | null },
    user: CurrentUser,
  ): boolean {
    return canAccessStudentRecord(student, user);
  }

  private ensureCanEdit(
    student: { managerId: string | null; chinaManagerId?: string | null },
    user: CurrentUser,
  ) {
    if (this.hasAccess(student, user)) return;
    throw new ForbiddenException(
      'Только назначенные менеджеры или администратор могут редактировать этого студента',
    );
  }

  /**
   * Общий «посев» полей заявки, создаваемой ИЗ КАРТОЧКИ СТУДЕНТА (create() и
   * ensureApplication()). Раньше обе точки собирали объект руками и обе
   * забывали три поля раздела 3.1 — source, phoneNormalized, repeatOfId.
   * Одно место вместо двух копий: тот же довод, что вынес canAccessStudentRecord
   * в common/access.ts и findRepeatOfId в common/application-repeat.ts.
   *
   * ИСТОЧНИК НЕ ВЫДУМЫВАЕТСЯ: normalizeSource(undefined) === null, то есть
   * «не указан». Подставлять сюда WEBSITE (как это делает публичная форма
   * лендинга) нельзя — офисный визит не приходил с сайта, и такой дефолт
   * испортил бы ровно тот отчёт по каналам, ради которого поле заведено.
   */
  private async buildApplicationSeed(
    student: {
      fullName: string;
      phones: string[];
      email: string | null;
      direction: Direction;
      comment: string | null;
      managerId: string | null;
      chinaManagerId: string | null;
    },
    lead: { source?: string; sourceDetail?: string } = {},
  ) {
    const phone = student.phones[0] || '';
    const phoneNormalized = normalizePhone(phone);
    // «Этот человек уже обращался?» — та же формула, что у заявки с лендинга.
    const repeatOfId = await findRepeatOfId(this.prisma, phoneNormalized, student.email);
    return {
      fullName: student.fullName,
      phone,
      email: student.email,
      direction: student.direction,
      comment: student.comment,
      managerId: student.managerId,
      chinaManagerId: student.chinaManagerId,
      source: normalizeSource(lead.source),
      sourceDetail: lead.sourceDetail?.trim() || null,
      phoneNormalized,
      repeatOfId,
    };
  }

  async create(dto: CreateStudentDto, user?: CurrentUser) {
    const cabinet = dto.cabinet ?? CABINET_BY_DIRECTION[dto.direction];
    const emailNormalized = dto.email.trim().toLowerCase();

    // Проверяем уникальность email среди студентов и пользователей
    const dupStudent = await this.prisma.student.findFirst({ where: { email: emailNormalized, deletedAt: null } });
    if (dupStudent) {
      throw new BadRequestException('Студент с таким email уже существует');
    }
    const dupUser = await this.prisma.user.findFirst({ where: { email: emailNormalized, deletedAt: null } });
    if (dupUser) {
      throw new BadRequestException('Этот email уже занят сотрудником');
    }

    // Генерим пароль, сохраняем хеш, возвращаем plain-текст один раз
    const plainPassword = generatePassword(8);
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    // Проблема D аудита (волна 0.1) и Проблема 6 аудита (волна 1): студент,
    // заведённый в CRM без назначенного менеджера, становится «бесхозным» —
    // по формуле hasAccess() (managerId/chinaManagerId оба null → «свободная»
    // запись) карточка доступна ЛЮБОМУ сотруднику на чтение/редактирование/
    // удаление до тех пор, пока кто-то её не возьмёт. Раньше от этого спасали
    // только EMPLOYEE-создателей (сам завёл — сам ведёт), а студент, заведённый
    // FOUNDER/ADMIN (штатный сценарий — они чаще всех заводят студентов
    // вручную), оставался бесхозным. CreateStudentDto пока не поддерживает
    // явного managerId при создании — единственный источник владельца это
    // сам создатель, поэтому назначаем ЛЮБОГО (включая FOUNDER/ADMIN)
    // автора карточки её менеджером. Переназначить можно в любой момент
    // через PATCH /students/:id/manager.
    const creatorManagerId = user ? user.id : null;

    const student = await this.prisma.student.create({
      data: {
        fullName: dto.fullName.trim(),
        phones: dto.phones?.length ? dto.phones : [],
        // ТЗ v3 р1 — производная от phones, пересчитывается при каждой записи.
        // Держать её в одной операции с phones обязательно: иначе появится
        // окно, где студент уже есть, а по телефону не находится.
        phoneSearch: buildPhoneSearch(dto.phones),
        email: emailNormalized,
        password: passwordHash,
        photoUrl: dto.photoUrl || null,
        direction: dto.direction,
        cabinet,
        status: dto.status ?? StudentStatus.ACTIVE,
        comment: dto.comment || null,
        managerId: creatorManagerId,
      },
      select: STUDENT_SELECT,
    });

    // Автосоздаём связанную заявку со статусом NEW, чтобы степпер этапов был
    // доступен сразу. Это нужно для студентов, заведённых вручную через CRM.
    // managerId/chinaManagerId копируем со студента — иначе заявка рождается
    // «бесхозной» той же самой Проблемой D, только с другой стороны.
    //
    // Раздел 3.1 ТЗ: эта заявка ОБЯЗАНА получить те же три поля, что и заявка
    // с лендинга (applications.service.create) — source, phoneNormalized,
    // repeatOfId. Раньше они здесь не проставлялись вовсе, и заявки,
    // заведённые вручную (то есть все офисные визиты), навсегда оставались
    // «Источник не указан» и не участвовали в поиске повторных обращений.
    // phoneNormalized тем более не мог дозаполниться фоновым бэкфиллом:
    // у студента без телефона phones[0] пуст, normalizePhone() вернёт null,
    // и строка перечитывалась бы на каждом старте приложения впустую.
    const applicationData = await this.buildApplicationSeed(student, {
      source: dto.source,
      sourceDetail: dto.sourceDetail,
    });
    const application = await this.prisma.application.create({
      data: {
        ...applicationData,
        status: 'NEW',
        studentId: student.id,
      },
    });

    // Сообщаем релевантным сотрудникам, что появилась новая заявка — чтобы
    // открытый /applications у них обновился без F5. Если студент ничей
    // (создан FOUNDER/ADMIN без назначения) — событие уходит всем сотрудникам,
    // чтобы кто-то взял его в работу (та же логика, что в hasAccess()).
    this.realtime.emitForStudent(student, 'application:new', { id: application.id, studentId: student.id });
    this.realtime.emitForStudent(student, 'student:created', { studentId: student.id });

    // Перечитываем студента уже с заявкой
    const withApp = await this.prisma.student.findUnique({
      where: { id: student.id },
      select: STUDENT_SELECT,
    });

    return { ...(withApp || student), plainPassword };
  }

  /**
   * Гарантирует, что у студента есть хотя бы одна заявка. Если нет — создаёт
   * новую со статусом NEW. Используется для студентов, заведённых вручную
   * до того, как авто-создание заявки появилось в коде.
   */
  async ensureApplication(id: string, user: CurrentUser) {
    const student = await this.findOne(id);
    this.ensureCanEdit(student, user);
    const existing = await this.prisma.application.findFirst({
      where: { studentId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return existing;
    }
    // Проблема D аудита: заявка копирует managerId/chinaManagerId со
    // студента — иначе она рождается «бесхозной» и по формуле hasAccess()
    // доступна ЛЮБОМУ сотруднику, даже если у студента менеджеры уже есть.
    // Раздел 3.1: source здесь остаётся null («не указан») — этот метод чинит
    // ЛЕГАСИ-студентов, заведённых до появления авто-создания заявки, и
    // откуда они пришли, система не знает. Менеджер проставит источник
    // вручную в карточке заявки.
    const applicationData = await this.buildApplicationSeed(student);
    const created = await this.prisma.application.create({
      data: {
        ...applicationData,
        status: 'NEW',
        studentId: id,
      },
    });
    this.realtime.emitForStudent(student, 'application:new', { id: created.id, studentId: id });
    this.realtime.emitStudent(id, 'student:updated', { studentId: id });
    return created;
  }

  async regeneratePassword(id: string, user: CurrentUser) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может сбрасывать пароль студента');
    }
    const existing = await this.findOne(id);
    if (!existing.email) {
      throw new BadRequestException('У студента нет email — невозможно создать доступ');
    }
    const plainPassword = generatePassword(8);
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await this.prisma.student.update({ where: { id }, data: { password: passwordHash } });
    return { email: existing.email, password: plainPassword };
  }

  async findAll(filters: {
    direction?: Direction;
    status?: StudentStatus;
    cabinet?: number;
    search?: string;
    mine?: boolean;
    managerUserId?: string;
    currentUserId?: string;
    currentUserRole?: Role;
    /** ТЗ v3 р4 — регион менеджера. undefined = как раньше (оба поля). */
    currentUserRegion?: Region;
    /** Фильтр по этапу — либо ApplicationStatus последней заявки,
     *  либо специальный StudentStatus (PAUSED/GRADUATED/ARCHIVED). */
    stage?: string;
    /**
     * Раздел 4 ТЗ (волна 4) — реестр «двойных грантов» прямо в общем списке:
     * 'multi' — есть незакрытый грант с totalYears > 1 (собственно «двойной»
     * грант); 'any' — есть хоть какой-то незакрытый грант (в т.ч. разовый);
     * 'none' — грантов нет вовсе. Без фильтра (undefined) условие не
     * применяется — 197 существующих студентов без единой строки в реестре
     * не должны внезапно пропасть из списка.
     */
    grant?: 'multi' | 'any' | 'none';
    /** Серверная пагинация. Если не передано — возвращаем всё (бэк-совместимость). */
    page?: number;
    pageSize?: number;
  }) {
    // Soft-delete: всегда исключаем удалённых студентов
    const where: Prisma.StudentWhereInput = { deletedAt: null };
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.cabinet) where.cabinet = filters.cabinet;
    const and: Prisma.StudentWhereInput[] = [];
    // Менеджеры (EMPLOYEE) всегда видят только своих, независимо от mine.
    const restrictToMine =
      (filters.mine && filters.currentUserId) ||
      (filters.currentUserRole === 'EMPLOYEE' && filters.currentUserId);
    if (restrictToMine) {
      // ТЗ v3 р4 — «только прикреплённые студенты из Китая / Таджикистана».
      // Регион решает, ПО КАКОМУ полю считать студента своим: TJ — managerId,
      // CN — chinaManagerId, BOTH — по любому из двух (прежнее поведение).
      // Формула общая с canAccessStudentRecord, иначе список и карточка
      // однажды разойдутся: студент виден в списке, но 404 при открытии.
      and.push({
        OR: assignedToUserFilter({
          id: filters.currentUserId!,
          role: filters.currentUserRole ?? 'EMPLOYEE',
          region: filters.currentUserRegion,
        }),
      });
    }
    // Фильтр по менеджеру (любой роли — TJ или CN).
    if (filters.managerUserId) {
      and.push({
        OR: [
          { managerId: filters.managerUserId },
          { chinaManagerId: filters.managerUserId },
        ],
      });
    }
    if (filters.search) {
      // ТЗ v3 раздел 1 — поиск по ФИО, email И телефону в любом формате.
      //
      // Раньше по телефону стояло `{ phones: { has: search } }` — точное
      // совпадение с элементом массива целиком. Найти студента можно было,
      // только набрав номер символ в символ, включая пробелы и дефисы ровно
      // так, как их поставил менеджер. Ни «901234567», ни «992901234567» для
      // записи «+992 90 123-45-67» не срабатывали.
      //
      // Теперь цифры запроса ищутся подстрокой в phoneSearch, где для каждого
      // номера лежат обе формы (с кодом страны и без) — см. buildPhoneSearch.
      const phoneDigits = phoneQuery(filters.search);
      const or: Prisma.StudentWhereInput[] = [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
      // Условие по телефону добавляем ТОЛЬКО когда в запросе есть цифры:
      // иначе `contains ''` совпало бы с каждым студентом, у кого телефон
      // вообще заполнен, и поиск по имени начал бы возвращать всю базу.
      if (phoneDigits) or.push({ phoneSearch: { contains: phoneDigits } });
      and.push({ OR: or });
    }
    // stageFilter — на бэкенд. Был клиентским (фильтр по applications[0]),
    // теперь делаем через relational query чтобы не тащить всё на фронт.
    const SPECIAL_STUDENT_STATUSES = new Set(['PAUSED', 'GRADUATED', 'ARCHIVED']);
    if (filters.stage) {
      if (SPECIAL_STUDENT_STATUSES.has(filters.stage)) {
        and.push({ status: filters.stage as StudentStatus });
      } else {
        // Студент активен И его последняя заявка имеет нужный статус.
        // Используем `some` — Prisma не умеет «последнюю» из 1:N, но
        // для практики достаточно «есть хотя бы одна с таким статусом»
        // (у студента обычно одна активная заявка).
        and.push({
          status: 'ACTIVE',
          applications: {
            some: { status: filters.stage as any, deletedAt: null },
          },
        });
      }
    }
    // Раздел 4 ТЗ (волна 4) — переиспользуем ЭТОТ ЖЕ where-билдер вместо
    // отдельного метода: реестр грантов живёт в GrantsService (grants/), но
    // общий список студентов тоже должен уметь отфильтровать «у кого есть
    // двойной грант» без похода на отдельный экран.
    if (filters.grant === 'multi') {
      and.push({ grants: { some: { deletedAt: null, totalYears: { gt: 1 } } } });
    } else if (filters.grant === 'any') {
      and.push({ grants: { some: { deletedAt: null } } });
    } else if (filters.grant === 'none') {
      and.push({ grants: { none: { deletedAt: null } } });
    }
    if (and.length) where.AND = and;

    // Если пагинация не запрошена — возвращаем массив (старый API).
    if (!filters.page || !filters.pageSize) {
      return this.prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: STUDENT_SELECT,
      });
    }

    // Серверная пагинация: одним хитом count + slice.
    const page = Math.max(1, filters.page);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize));
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: STUDENT_LIST_SELECT,
      }),
      this.prisma.student.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /**
   * `user` передаётся только из контроллера (публичный HTTP-запрос).
   * Внутренние вызовы из других методов сервиса (update/updateForm/remove/...)
   * зовут findOne(id) без user — они сами вызывают ensureCanEdit() ПОСЛЕ
   * чтения, чтобы сохранить прежние тексты и коды ошибок (403, не 404).
   */
  async findOne(id: string, user?: CurrentUser) {
    // Soft-delete: удалённого не возвращаем (атакующий не получит
    // данные через GET /students/:id, даже если знает id).
    const student = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
      select: STUDENT_SELECT,
    });
    if (!student) throw new NotFoundException('Студент не найден');
    // БАГ 2 аудита: EMPLOYEE не должен прочитать чужую карточку по UUID.
    // Отдаём 404 (не 403) — иначе ответ работает как оракул существования id.
    if (user && !this.hasAccess(student, user)) {
      throw new NotFoundException('Студент не найден');
    }
    return student;
  }

  async update(id: string, dto: UpdateStudentDto, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);

    const data: Prisma.StudentUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.phones !== undefined) {
      data.phones = dto.phones;
      // Пересчитываем ВМЕСТЕ с phones и только когда phones реально пришли:
      // безусловная запись затирала бы поисковую строку в null при любой
      // правке имени или комментария.
      data.phoneSearch = buildPhoneSearch(dto.phones);
    }
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.photoUrl !== undefined) data.photoUrl = dto.photoUrl;
    if (dto.comment !== undefined) data.comment = dto.comment;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.direction !== undefined) {
      data.direction = dto.direction;
      if (dto.cabinet === undefined) {
        data.cabinet = CABINET_BY_DIRECTION[dto.direction];
      }
    }
    if (dto.cabinet !== undefined) data.cabinet = dto.cabinet;

    const updated = await this.prisma.student.update({
      where: { id },
      data,
      select: STUDENT_SELECT,
    });

    // Application.phoneNormalized — рабочий ключ определения звонящего
    // (calls.service.ts) и поиска повторных обращений; он проставляется ОДИН
    // раз при создании заявки. Симметричный путь applications.service.update()
    // пересчитывает его явно, а здесь этого не было: после исправления
    // опечатки в номере студента входящий звонок с ВЕРНОГО номера карточку не
    // открывал, а со старого, неверного — открывал. Сравниваем со старым
    // первым номером, чтобы не переписывать заявки при правке одного ФИО.
    const prevPhone = existing.phones[0] ?? null;
    const nextPhone = dto.phones !== undefined ? (updated.phones[0] ?? null) : null;
    if (nextPhone && nextPhone !== prevPhone) {
      const normalized = normalizePhone(nextPhone);
      await this.prisma.application.updateMany({
        where: { studentId: id, deletedAt: null },
        // normalizePhone вернул null (номер нераспознаваем) — ключ НЕ трогаем:
        // пустое/обнулённое значение склеило бы такие заявки в одну «семью»
        // повторных обращений (см. common/phone.ts). repeatOfId не
        // пересчитываем — это исторический факт первого обращения.
        data: normalized ? { phone: nextPhone, phoneNormalized: normalized } : { phone: nextPhone },
      });
    }

    this.realtime.emitForStudent(updated, 'student:updated', { studentId: id }, { studentId: id });

    // Логируем и уведомляем менеджеров студента о каждом изменённом поле
    const FIELD_LABELS: Record<string, string> = {
      fullName: 'ФИО',
      phones: 'Телефоны',
      email: 'Email',
      direction: 'Направление',
      cabinet: 'Кабинет',
      status: 'Статус',
      comment: 'Комментарий',
      photoUrl: 'Фото',
    };
    const changes: string[] = [];
    for (const k of Object.keys(FIELD_LABELS)) {
      const before = (existing as any)[k];
      const after = (updated as any)[k];
      const beforeS = Array.isArray(before) ? before.join(', ') : (before ?? '—');
      const afterS = Array.isArray(after) ? after.join(', ') : (after ?? '—');
      if (String(beforeS) !== String(afterS)) {
        changes.push(`${FIELD_LABELS[k]}: ${beforeS} → ${afterS}`);
      }
    }
    if (changes.length > 0) {
      const summary = changes.join('; ');
      this.activity?.log?.({
        actorId: user.id,
        actorRole: user.role,
        action: 'STUDENT_UPDATE',
        studentId: id,
        studentName: updated.fullName,
        details: summary,
      }).catch(() => undefined);
      // Проблема C аудита: раньше notifyAllStaff() слала уведомление
      // (ФИО студента + дифф изменённых полей, включая телефоны/email)
      // КАЖДОМУ сотруднику компании — рядовой менеджер собирал оттуда
      // телефоны/email/UUID чужих студентов, просто читая свой колокольчик.
      // Теперь получатели — только назначенные менеджеры этого студента
      // плюс FOUNDER/ADMIN (им нужно видеть всё для контроля).
      this.notifications
        ?.notifyForStudent?.(updated, {
          type: 'STUDENT_UPDATE',
          title: 'Изменения у студента',
          message: `${updated.fullName}: ${summary}`,
          payload: { studentId: id },
        })
        .catch(() => undefined);
    }

    return updated;
  }

  /** Сохраняет анкету студента из CRM (admin / manager). */
  async updateForm(id: string, form: any, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);
    const updated = await this.prisma.student.update({
      where: { id },
      data: { applicationForm: form },
      select: STUDENT_SELECT,
    });
    this.realtime.emitForStudent(updated, 'form:updated', { studentId: id }, { studentId: id });
    this.realtime.emitForStudent(updated, 'student:updated', { studentId: id }, { studentId: id });
    this.activity?.log?.({
      actorId: user.id,
      actorRole: user.role,
      action: 'STUDENT_UPDATE',
      studentId: id,
      studentName: updated.fullName,
      details: 'Изменена анкета студента',
    }).catch(() => undefined);
    return updated;
  }

  async assignManager(
    id: string,
    patch: { managerId?: string | null; chinaManagerId?: string | null },
    user: CurrentUser,
  ) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор может переназначать менеджеров');
    }
    await this.findOne(id);

    const data: any = {};
    if (patch.managerId !== undefined) {
      if (patch.managerId) {
        const exists = await this.prisma.user.findFirst({ where: { id: patch.managerId, deletedAt: null } });
        if (!exists) throw new NotFoundException('Локальный менеджер не найден');
      }
      data.managerId = patch.managerId;
    }
    if (patch.chinaManagerId !== undefined) {
      if (patch.chinaManagerId) {
        const exists = await this.prisma.user.findFirst({ where: { id: patch.chinaManagerId, deletedAt: null } });
        if (!exists) throw new NotFoundException('Китайский менеджер не найден');
      }
      data.chinaManagerId = patch.chinaManagerId;
    }

    // Синхронизируем на связанных заявках
    if (Object.keys(data).length > 0) {
      await this.prisma.application.updateMany({ where: { studentId: id }, data });
    }
    const updated = await this.prisma.student.update({
      where: { id },
      data,
      select: STUDENT_SELECT,
    });
    // Проблема 7 аудита волны 1: приватный кэш FileResolverService хранит
    // managerId/chinaManagerId на момент последнего резолва файла и живёт
    // до 5 минут (PRIVATE_CACHE_TTL_MS) — без сброса снятый с карточки
    // менеджер мог бы ещё эти 5 минут скачивать документы/фото студента.
    this.fileResolver.invalidateForStudent(id);
    // Роутим по НОВЫМ менеджерам (updated) — переназначение считается «в
    // момент emit», перетасовывать room-membership не нужно (см. realtime.gateway).
    this.realtime.emitForStudent(updated, 'student:updated', { studentId: id }, { studentId: id });
    this.realtime.emitForStudent(updated, 'application:updated', { studentId: id });
    return updated;
  }

  /**
   * Soft delete: помечаем deletedAt = now(). Физически студент остаётся
   * в БД со всеми документами и заявками — данные восстанавливаемы.
   */
  async remove(id: string, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);
    await this.prisma.student.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    // БАГ 4 аудита: сбрасываем кэш StudentJwtGuard, иначе удалённый студент
    // ещё до 30 секунд может ходить в личный кабинет по старому токену.
    invalidateStudentCache(id);
    // Проблема 7 аудита волны 1: resolvePhoto()/resolveDocument() проверяют
    // deletedAt студента только на момент промаха кэша — до 5 минут после
    // soft-delete приватный кэш ещё мог бы отдавать «allow» по устаревшим данным.
    this.fileResolver.invalidateForStudent(id);
    return { ok: true };
  }

  async addDocument(
    studentId: string,
    file: { filename: string; originalname: string; mimetype: string; size: number; url: string },
    type: string = 'OTHER',
    user?: CurrentUser,
  ) {
    const existing = await this.findOne(studentId);
    if (user) this.ensureCanEdit(existing, user);
    // Раньше на каждый тип хранили только один документ — теперь разрешаем
    // несколько файлов в одной категории (студент может загрузить, например,
    // паспорт + копию + перевод в одну плитку «Загран паспорт»).
    const doc = await this.prisma.document.create({
      data: {
        studentId,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: file.url,
        type,
      },
    });
    // Проблема B аудита: раньше в payload летел весь `doc`, включая `url` —
    // прямую ссылку на файл (паспорт/BANK/MEDICAL). С закрытым /uploads
    // (files/uploads-access.service.ts) ссылка всё равно ничего не откроет
    // без прав, но лучше вообще не палить путь тем, кому документ не по
    // работе. Фронт получает сигнал + id и подтягивает документ по HTTP,
    // где авторизация уже проверена.
    this.realtime.emitForStudent(existing, 'document:uploaded', { studentId, docId: doc.id }, { studentId });
    this.realtime.emitForStudent(existing, 'student:updated', { studentId }, { studentId });

    // Раздел 6.3 ТЗ (волна 4): загрузка документа студента раньше не
    // логировалась вообще (в отличие от чеков платежей). Загрузка из личного
    // кабинета студента (student-auth.controller.ts) идёт СВОИМ путём, минуя
    // этот метод — здесь `user` всегда присутствует (единственный вызывающий
    // код — students.controller.ts, за JwtAuthGuard).
    if (user) {
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'DOCUMENT_UPLOAD',
          studentId,
          studentName: existing.fullName,
          details: `Загружен документ: ${DOCUMENT_TYPE_LABEL[type] ?? type}`,
        })
        .catch(() => undefined);
    }

    return doc;
  }

  async removeDocument(documentId: string, user: CurrentUser) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      // chinaManagerId обязателен в select — без него ensureCanEdit ниже
      // сравнивал бы с undefined, и китайский менеджер не мог бы удалить
      // документ своего же студента. fullName — только для ActivityLog (волна 4).
      // ticketId нужен assertNotManagedDocument ниже (волна 8).
      include: { student: { select: { managerId: true, chinaManagerId: true, fullName: true } } },
    });
    if (!doc) throw new NotFoundException('Документ не найден');
    // ПОРЯДОК ПРОВЕРОК ВАЖЕН: сначала права на студента, потом бизнес-инвариант.
    // Если сделать наоборот, сообщение «Чек платежа удаляется только через
    // раздел Финансы» прилетит раньше проверки доступа — и посторонний
    // сотрудник, перебирая UUID, по тексту ответа узнаёт, что документ
    // является чеком, ещё не имея права его видеть.
    if (doc.student) this.ensureCanEdit(doc.student, user);
    // Проблема 1 аудита волны 1: этот эндпоинт (DELETE /students/documents/:docId)
    // не различал обычный документ и чек платежа — менеджер мог soft-удалить
    // чек уже ОДОБРЕННОГО платежа в обход payments.service.removeReceipt()
    // (тот пускает удаление только для DRAFT/REJECTED). Чек — не документ
    // студента, а часть финансового аудит-следа, управляется только payments/.
    // Волна 8 добавила в тот же список файлы билетов — по той же причине.
    assertNotManagedDocument(doc);
    // Soft delete: помечаем deletedAt. Файл на диске остаётся, но в UI и
    // в архивах студентов больше не отображается. Восстановление = снять метку.
    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
    const studentId = (doc as any).studentId;
    // Проблема 7 аудита волны 1: приватный кэш FileResolverService хранит
    // ref.deletedAt на момент последнего резолва — без сброса /uploads ещё
    // до 5 минут продолжал бы отдавать только что удалённый документ.
    if (studentId) this.fileResolver.invalidateForStudent(studentId);
    if (studentId && doc.student) {
      this.realtime.emitForStudent(doc.student, 'document:deleted', { studentId, docId: documentId }, { studentId });
      this.realtime.emitForStudent(doc.student, 'student:updated', { studentId }, { studentId });
      // Раздел 6.3 ТЗ (волна 4): раньше удаление документа студента не
      // логировалось вообще (в отличие от удаления чека платежа).
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'DOCUMENT_DELETE',
          studentId,
          studentName: doc.student.fullName,
          details: `Удалён документ: ${DOCUMENT_TYPE_LABEL[doc.type] ?? doc.type}`,
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  async stats(user?: { id: string; role: Role }) {
    // Soft-delete: считаем только активных. EMPLOYEE видит только своих.
    const where: Prisma.StudentWhereInput =
      user && user.role === 'EMPLOYEE'
        ? {
            deletedAt: null,
            OR: [{ managerId: user.id }, { chinaManagerId: user.id }],
          }
        : { deletedAt: null };
    const [total, byCabinet, byDirection] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.groupBy({
        by: ['cabinet'],
        _count: true,
        orderBy: { cabinet: 'asc' },
        where,
      }),
      this.prisma.student.groupBy({ by: ['direction'], _count: true, where }),
    ]);
    return { total, byCabinet, byDirection };
  }
}
