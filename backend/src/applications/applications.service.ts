import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { ApplicationStatus, Direction, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { TelegramService } from '../telegram/telegram.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { REQUIRED_DOCUMENT_TYPES } from '../common/documents';
import { isPrivileged } from '../common/roles';
import { canAccessStudentRecord } from '../common/access';
import { STUDENT_SAFE_FIELDS } from '../common/student-fields';
import { invalidateStudentCache } from '../student-auth/student-jwt.guard';
import { FileResolverService } from '../files/file-resolver.service';
import { buildPhoneSearch, normalizePhone, phoneContainsConditions } from '../common/phone';
import { normalizeSource } from '../common/lead-source';
import { findRepeatOfId } from '../common/application-repeat';
import { claimEnrolled, claimFirstTouch } from '../common/lead-touch';

const CABINET_BY_DIRECTION: Record<Direction, number> = {
  BACHELOR: 1,
  MASTER: 2,
  LANGUAGE: 3,
  LANGUAGE_COLLEGE: 4,
  LANGUAGE_BACHELOR: 5,
  COLLEGE: 6,
};

const DIRECTION_LABEL: Record<Direction, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
  LANGUAGE_COLLEGE: 'Языковой + колледж',
  LANGUAGE_BACHELOR: 'Языковой + бакалавриат',
  COLLEGE: 'Колледж',
};

const MANAGER_INCLUDE = {
  student: {
    // select (не include!) — иначе Prisma подтягивает ВСЕ скалярные поля
    // Student по умолчанию, включая `password` (bcrypt-хэш пароля личного
    // кабинета студента). GET /applications и GET /applications/:id
    // раньше отдавали этот хэш в каждом ответе через вложенного student.
    // STUDENT_SAFE_FIELDS — общий с students.service.ts список (Проблема G
    // аудита: раньше был продублирован здесь дословно).
    select: {
      ...STUDENT_SAFE_FIELDS,
      manager: { select: { id: true, fullName: true, email: true } },
      chinaManager: { select: { id: true, fullName: true, email: true } },
      program: true,
    },
  },
  manager: { select: { id: true, fullName: true, email: true } },
  chinaManager: { select: { id: true, fullName: true, email: true } },
  program: true,
  // Раздел 3.1 ТЗ: банер «в архиве» в карточке заявки должен показывать, кто
  // и когда её архивировал — без этого include пришлось бы делать второй
  // запрос на каждое открытие карточки.
  archivedBy: { select: { id: true, fullName: true } },
};

// Облегчённый include для СПИСКА заявок: только то, что нужно в таблице.
// Не тащим вложенного студента с его programs/managers — это десятки полей
// на заявку. Полная карточка получает MANAGER_INCLUDE через GET /:id.
const APPLICATION_LIST_INCLUDE = {
  student: { select: { id: true, fullName: true, photoUrl: true } },
  manager: { select: { id: true, fullName: true } },
  chinaManager: { select: { id: true, fullName: true } },
};

/** ТЗ 3.1 — вкладки раздела «Заявки». 'all' — дефолт. */
export type ApplicationTab = 'all' | 'new' | 'in_work' | 'archive';

export interface ApplicationListFilters {
  status?: ApplicationStatus;
  direction?: Direction;
  search?: string;
  mine?: boolean;
  managerUserId?: string;
  currentUserId?: string;
  currentUserRole?: Role;
  /** ТЗ 3.1 — источник привлечения. 'NONE' — отдельный пункт «Не указан» (source: null). */
  source?: string;
  /** ТЗ 3.1 — фильтр по датам (createdAt), копия подхода activity.service.ts. */
  from?: Date;
  to?: Date;
  /** true — только заявки с repeatOfId (повторные обращения). */
  repeat?: boolean;
  /** Серверная пагинация. Если не передано — возвращаем массив (бэк-совместимость). */
  page?: number;
  pageSize?: number;
}

type CurrentUser = { id: string; role: Role };

@Injectable()
export class ApplicationsService implements OnModuleInit {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private telegram: TelegramService,
    private mail: MailService,
    private sms: SmsService,
    private activity: ActivityService,
    private realtime: RealtimeGateway,
    private fileResolver: FileResolverService,
  ) {}

  /**
   * Раздел 3.1 ТЗ: разовый идемпотентный бэкфилл phoneNormalized для заявок,
   * созданных до появления этого поля (229 исторических строк). Условие
   * `phoneNormalized: null` в WHERE делает вызов идемпотентным — уже
   * обработанные строки не попадут в выборку на следующем старте. Батч
   * ограничен (с большим запасом на вырост) — на текущем объёме это один
   * проход, при 10x данных не блокирует бесконечно.
   * Запускается в фоне (промис не awaited внутри onModuleInit), чтобы не
   * задерживать старт приложения.
   */
  async onModuleInit(): Promise<void> {
    // .catch() ОБЯЗАТЕЛЕН. Без него любая транзиентная ошибка БД на старте
    // (Railway поднимает Postgres дольше приложения, обрыв пула, таймаут
    // первого коннекта) превращается в unhandled rejection, а Node с
    // дефолтными настройками валит на этом процесс — контейнер уходит
    // в рестарт-луп из-за необязательного фонового бэкфилла.
    // Не страшно, если он не отработал: условие `phoneNormalized: null`
    // делает его идемпотентным, следующий старт просто повторит.
    void this.backfillPhoneNormalized().catch((e) => {
      this.logger.warn(
        `Бэкфилл phoneNormalized не выполнен (повторится при следующем старте): ${e?.message ?? e}`,
      );
    });
  }

  private async backfillPhoneNormalized(): Promise<void> {
    const BATCH = 1000;
    const rows = await this.prisma.application.findMany({
      where: { phoneNormalized: null, deletedAt: null },
      select: { id: true, phone: true },
      take: BATCH,
    });
    if (!rows.length) return;

    let filled = 0;
    for (const row of rows) {
      // Заявки без распознаваемого телефона (легаси из students.service,
      // `phones[0] || ''`) останутся null и будут перечитываться на каждом
      // старте — это ожидаемо (см. common/phone.ts) и безопасно: их всего
      // ~1000 максимум за проход, и они физически не могут дать корректный ключ.
      const normalized = normalizePhone(row.phone);
      if (!normalized) continue;
      await this.prisma.application
        .update({ where: { id: row.id }, data: { phoneNormalized: normalized } })
        .catch(() => undefined);
      filled += 1;
    }
    this.logger.log(`Бэкфилл phoneNormalized: просмотрено ${rows.length}, заполнено ${filled}`);
  }

  // Порядок этапов воронки — для определения, "понизили" или "продвинули" заявку
  private static STAGE_ORDER: ApplicationStatus[] = [
    'NEW',
    'DOCS_REVIEW',
    'DOCS_SUBMITTED',
    'PRE_ADMISSION',
    'AWAITING_PAYMENT',
    'ENROLLED',
  ];

  private isDowngrade(prev: ApplicationStatus, next: ApplicationStatus): boolean {
    const a = ApplicationsService.STAGE_ORDER.indexOf(prev);
    const b = ApplicationsService.STAGE_ORDER.indexOf(next);
    return a >= 0 && b >= 0 && b < a;
  }

  private smsTextForStatus(prev: ApplicationStatus, next: ApplicationStatus): string {
    const labelNext = ApplicationsService.STATUS_LABEL[next] || next;
    const labelPrev = ApplicationsService.STATUS_LABEL[prev] || prev;
    if (next === 'ENROLLED') {
      return `🎉 GrantChina: Поздравляем! Вы зачислены. Подробности в личном кабинете.`;
    }
    if (this.isDowngrade(prev, next)) {
      return `GrantChina: Заявка возвращена с «${labelPrev}» на «${labelNext}». Свяжитесь с менеджером для уточнений.`;
    }
    return `GrantChina: Статус Вашей заявки изменён: «${labelPrev}» → «${labelNext}».`;
  }

  /** Возвращает первый непустой номер телефона: из заявки, потом из связанного студента. */
  private async resolvePhone(app: { phone: string | null; studentId?: string | null }): Promise<string | null> {
    if (app.phone && app.phone.trim()) return app.phone.trim();
    if (app.studentId) {
      const s = await this.prisma.student.findUnique({
        where: { id: app.studentId },
        select: { phones: true },
      });
      const first = s?.phones?.[0];
      if (first && first.trim()) return first.trim();
    }
    return null;
  }

  private static STATUS_LABEL: Record<ApplicationStatus, string> = {
    NEW: 'Новая заявка',
    IN_PROGRESS: 'В работе',
    COMPLETED: 'Завершена',
    DOCS_REVIEW: 'Документы на проверке',
    DOCS_SUBMITTED: 'Документы поданы',
    PRE_ADMISSION: 'Предварительное зачисление',
    AWAITING_PAYMENT: 'Ожидание оплаты',
    ENROLLED: 'Зачислен',
  };

  async create(dto: CreateApplicationDto) {
    const phone = dto.phone.trim();
    const email = dto.email?.trim() || null;
    const phoneNormalized = normalizePhone(phone);
    // POST /applications/public — единственный путь, где источник по
    // умолчанию проставляется на сервере (это форма сайта в буквальном
    // смысле). Остальные пути создания заявок (students.service.ts) не
    // должны наследовать этот дефолт — иначе офисные визиты помечались бы
    // "Сайт". @IsIn(LEAD_SOURCE_VALUES) в DTO уже отсеял мусор до сюда.
    const source = normalizeSource(dto.source) ?? 'WEBSITE';
    const sourceDetail = dto.sourceDetail?.trim() || null;
    // ТЗ 3.1 — «повторное обращение»: раньше телефон/email этого человека
    // уже встречались? Раньше самой заявки её ещё нет в БД, поэтому исключать
    // self здесь не нужно.
    const repeatOfId = await findRepeatOfId(this.prisma, phoneNormalized, email);

    const app = await this.prisma.application.create({
      data: {
        fullName: dto.fullName.trim(),
        phone,
        email,
        direction: dto.direction,
        comment: dto.comment?.trim() || null,
        programId: dto.programId || null,
        source,
        sourceDetail,
        phoneNormalized,
        repeatOfId,
      },
    });

    // Новая публичная заявка ещё не имеет менеджера — её должны увидеть
    // только FOUNDER и ADMIN, чтобы кто-то её назначил.
    await this.notifications.notifyAdminsAndFounders({
      type: 'APPLICATION_NEW',
      title: 'Новая заявка',
      message: `${app.fullName} — ${DIRECTION_LABEL[app.direction]}, ${app.phone}`,
      payload: { applicationId: app.id },
    });

    const tgText =
      `🆕 *Новая заявка GrantChina*\n` +
      `*ФИО:* ${app.fullName}\n` +
      `*Телефон:* ${app.phone}\n` +
      (app.email ? `*Email:* ${app.email}\n` : '') +
      `*Направление:* ${DIRECTION_LABEL[app.direction]}\n` +
      (app.comment ? `*Комментарий:* ${app.comment}` : '');
    this.telegram.send(tgText).catch(() => undefined);

    this.mail
      .sendToAdmin(
        `Новая заявка: ${app.fullName}`,
        `<h2>Новая заявка с лендинга</h2>
         <p><b>ФИО:</b> ${app.fullName}</p>
         <p><b>Телефон:</b> ${app.phone}</p>
         ${app.email ? `<p><b>Email:</b> ${app.email}</p>` : ''}
         <p><b>Направление:</b> ${DIRECTION_LABEL[app.direction]}</p>
         ${app.comment ? `<p><b>Комментарий:</b> ${app.comment}</p>` : ''}`,
      )
      .catch(() => undefined);

    // SMS студенту: подтверждение получения заявки
    this.sms
      .send(
        app.phone,
        `GrantChina: Ваша заявка получена. Менеджер свяжется с Вами в ближайшее время.`,
      )
      .catch(() => undefined);

    // Публичная заявка с лендинга всегда без менеджера — её должен увидеть
    // весь staff, чтобы кто-то взял в работу. Payload — только id (Проблема B
    // аудита: фронт (Applications.tsx) на любое application:* просто
    // перезапрашивает список по HTTP, где авторизация уже проверена;
    // сама заявка ещё не содержит studentId/PII на этом этапе).
    this.realtime.emitAllStaff('application:new', { id: app.id });

    // ЭТОТ ОТВЕТ УХОДИТ АНОНИМУ (POST /applications/public с лендинга).
    // Возвращать весь ряд нельзя: волна 3 добавила в Application поля
    // repeatOfId и phoneNormalized. repeatOfId — это UUID ЧУЖОЙ, ранее
    // созданной заявки того же человека, то есть любой желающий мог бы
    // отправить форму с чужим номером телефона и узнать (а) что этот человек
    // уже обращался в агентство, и (б) реальный UUID его заявки.
    // До волны 3 в ответе не было ни одного поля, ссылающегося на другие
    // записи, поэтому проблема новая. Отдаём ровно то, что нужно лендингу
    // для показа «спасибо, заявка принята».
    return {
      id: app.id,
      fullName: app.fullName,
      direction: app.direction,
      status: app.status,
      createdAt: app.createdAt,
    };
  }

  /**
   * Общие условия фильтрации, ОБЩИЕ для findAll() и tabCounts() — без этого
   * счётчики вкладок разъехались бы со списком при любой правке одного из
   * двух мест (см. риск 6 проекта архитектора: список vs дашборд).
   */
  private buildFilterConditions(
    filters: Omit<ApplicationListFilters, 'page' | 'pageSize'>,
  ): Prisma.ApplicationWhereInput[] {
    const and: Prisma.ApplicationWhereInput[] = [];
    if (filters.status) and.push({ status: filters.status });
    if (filters.direction) and.push({ direction: filters.direction });
    // EMPLOYEE всегда видит только свои заявки (даже если mine=false на фронте).
    const restrictToMine =
      (filters.mine && filters.currentUserId) ||
      (filters.currentUserRole === 'EMPLOYEE' && filters.currentUserId);
    if (restrictToMine) {
      and.push({
        OR: [
          { managerId: filters.currentUserId },
          { chinaManagerId: filters.currentUserId },
        ],
      });
    }
    // Фильтр по конкретному менеджеру: показываем заявки где он
    // назначен либо локальным, либо китайским менеджером.
    if (filters.managerUserId) {
      and.push({
        OR: [
          { managerId: filters.managerUserId },
          { chinaManagerId: filters.managerUserId },
        ],
      });
    }
    // 'NONE' — обязательный пункт фильтра: без него 229 исторических заявок
    // без источника недостижимы ни одним значением фильтра.
    if (filters.source !== undefined) {
      and.push({ source: filters.source === 'NONE' ? null : filters.source });
    }
    if (filters.from || filters.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (filters.from) createdAt.gte = filters.from;
      if (filters.to) createdAt.lte = filters.to;
      and.push({ createdAt });
    }
    if (filters.repeat) and.push({ repeatOfId: { not: null } });
    if (filters.search) {
      // ТЗ v3 раздел 1 — «поиск должен находить записи независимо от формата
      // ввода (+992, +86, пробелы, дефисы или без них)».
      //
      // Одного `phone: { contains: search }` для этого мало: phone хранит
      // СЫРУЮ строку в том виде, как её напечатал менеджер («+992 90 123-45-67»),
      // и запрос «901234567» по ней не находит ничего — между цифрами стоят
      // пробелы и дефисы. Поэтому ищем ещё и по phoneNormalized (только цифры).
      //
      // ДВА варианта цифр, а не один. phoneNormalized хранит НАЦИОНАЛЬНЫЙ
      // номер БЕЗ кода страны (см. normalizePhone), а пользователь одинаково
      // часто вводит и с кодом, и без:
      //   - digits   — цифры запроса как есть: покрывает ввод БЕЗ кода
      //                («901234567») и любой ЧАСТИЧНЫЙ ввод («1234»), для
      //                которого normalizePhone вернёт null (короче 7 цифр);
      //   - national — тот же normalizePhone, что применялся при записи:
      //                покрывает ввод С кодом («+992 90 123-45-67» →
      //                «992901234567» → «901234567»), который иначе не совпал
      //                бы с хранимым значением ни одной своей подстрокой.
      // Обе формы прогоняются через ту же функцию, что заполняла колонку, —
      // поэтому запрос и хранимое значение гарантированно приводятся к одному
      // виду, а не к двум похожим.
      const or: Prisma.ApplicationWhereInput[] = [
        { fullName: { contains: filters.search, mode: 'insensitive' } },
        // Сырое поле оставляем: у заявок, заведённых из students.service
        // (`phones[0] || ''`), и у части исторических строк phoneNormalized
        // остаётся null — по ним ищет только эта ветка.
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        // Обе формы запроса разом. Пустой массив при текстовом запросе
        // («Иван»): `contains ''` совпало бы с каждой заявкой с распознанным
        // телефоном, и поиск по имени вернул бы всю базу.
        ...phoneContainsConditions('phoneNormalized', filters.search),
      ];
      and.push({ OR: or });
    }
    return and;
  }

  /**
   * ТЗ 3.1 — условие конкретной вкладки. Пересечение 'new'/'in_work' с
   * 'archive' для НЕархивированных повторных обращений НАМЕРЕННОЕ (см.
   * archiveRule проекта архитектора): свежий повтор обязан остаться в
   * очереди «Новые», а во вкладке «Архив» виден под другим углом.
   */
  private tabCondition(tab: ApplicationTab | undefined): Prisma.ApplicationWhereInput {
    switch (tab) {
      case 'new':
        return { archivedAt: null, status: 'NEW' };
      case 'in_work':
        return { archivedAt: null, status: { not: 'NEW' } };
      case 'archive':
        return { OR: [{ archivedAt: { not: null } }, { repeatOfId: { not: null } }] };
      case 'all':
      default:
        return { archivedAt: null };
    }
  }

  async findAll(filters: ApplicationListFilters & { tab?: ApplicationTab }) {
    // Soft-delete: всегда исключаем удалённые заявки
    const where: Prisma.ApplicationWhereInput = { deletedAt: null };
    const and = this.buildFilterConditions(filters);
    and.push(this.tabCondition(filters.tab));
    where.AND = and;

    if (!filters.page || !filters.pageSize) {
      return this.prisma.application.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: MANAGER_INCLUDE,
      });
    }

    const page = Math.max(1, filters.page);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize));
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: APPLICATION_LIST_INCLUDE,
      }),
      this.prisma.application.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /**
   * ТЗ 3.1 — счётчики вкладок с учётом ВСЕХ текущих фильтров, КРОМЕ tab
   * (иначе переключение вкладки туда-обратно теряло бы контекст фильтра).
   * 4 count() в одном $transaction — на объёме проекта (229 заявок) это
   * ничто; при кратном росте базы (~100k+) заменить на один GROUP BY —
   * см. риск 15 проекта архитектора.
   */
  async tabCounts(filters: ApplicationListFilters) {
    const baseAnd = this.buildFilterConditions(filters);
    const withTab = (tab: ApplicationTab): Prisma.ApplicationWhereInput => ({
      deletedAt: null,
      AND: [...baseAnd, this.tabCondition(tab)],
    });
    const [all, newCount, inWork, archive] = await this.prisma.$transaction([
      this.prisma.application.count({ where: withTab('all') }),
      this.prisma.application.count({ where: withTab('new') }),
      this.prisma.application.count({ where: withTab('in_work') }),
      this.prisma.application.count({ where: withTab('archive') }),
    ]);
    return { all, new: newCount, in_work: inWork, archive };
  }

  /**
   * `user` передаётся только из контроллера (публичный HTTP-запрос).
   * Внутренние вызовы findOne(id) без user — из update/assignManager/remove,
   * которые сами вызывают ensureCanEdit() ПОСЛЕ чтения (сохраняем прежние
   * тексты и коды ошибок — 403, а не 404 — для этих сценариев).
   */
  async findOne(id: string, user?: CurrentUser) {
    // Soft-delete: удалённая заявка скрыта от API (404).
    const app = await this.prisma.application.findFirst({
      where: { id, deletedAt: null },
      include: MANAGER_INCLUDE,
    });
    if (!app) throw new NotFoundException('Заявка не найдена');
    // БАГ 2 аудита: EMPLOYEE не должен прочитать чужую заявку по UUID.
    // Отдаём 404 (не 403) — иначе ответ работает как оракул существования id.
    if (user && !this.hasAccess(app, user)) {
      throw new NotFoundException('Заявка не найдена');
    }
    return app;
  }

  /**
   * Единая проверка доступа к заявке: используется и для чтения (findOne),
   * и для записи (ensureCanEdit) — правило одно и то же.
   *  - FOUNDER и ADMIN видят/редактируют все заявки;
   *  - EMPLOYEE — только назначенные лично ему (managerId/chinaManagerId),
   *    либо ещё никому не назначенные («свободные» — их может взять любой).
   */
  private hasAccess(
    app: { managerId: string | null; chinaManagerId?: string | null },
    user: CurrentUser,
  ): boolean {
    return canAccessStudentRecord(app, user);
  }

  private ensureCanEdit(
    app: { managerId: string | null; chinaManagerId?: string | null },
    user: CurrentUser,
  ) {
    if (this.hasAccess(app, user)) return;
    throw new ForbiddenException(
      'Только назначенные менеджеры или администратор могут редактировать эту заявку',
    );
  }

  /** ActivityLog при ручной правке источника через карточку заявки (ТЗ 3.1). */
  private logSourceChange(existing: { source: string | null }, dto: UpdateApplicationDto, updated: { studentId: string | null; fullName: string }, user: CurrentUser) {
    if (dto.source === undefined || dto.source === existing.source) return;
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'APPLICATION_SOURCE_CHANGE',
        studentId: updated.studentId,
        studentName: updated.fullName,
        details: `Источник: ${existing.source ?? 'не указан'} → ${dto.source}`,
      })
      .catch(() => undefined);
  }

  async update(id: string, dto: UpdateApplicationDto, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);

    // Раздел 5 ТЗ (волна 6) — метрика KPI «обработанный лид» (ТЗ 5.1):
    // «первый уход статуса из NEW» — ЛЮБАЯ смена статуса, уводящая заявку
    // с NEW, а не только конкретный переход на DOCS_REVIEW ниже.
    const leavingNew = dto.status !== undefined && dto.status !== existing.status && existing.status === ApplicationStatus.NEW;

    // Ручная правка телефона обязана держать phoneNormalized (ключ поиска
    // повторных обращений) в актуальном состоянии — иначе денормализованная
    // колонка тихо разъедется с исходным полем после первого же PATCH.
    const updateData: Prisma.ApplicationUncheckedUpdateInput = { ...dto };
    if (dto.phone !== undefined) {
      updateData.phoneNormalized = normalizePhone(dto.phone);
    }

    // Авто-создание студента при переходе NEW → DOCS_REVIEW (если ещё не создан)
    if (
      dto.status === ApplicationStatus.DOCS_REVIEW &&
      existing.status === ApplicationStatus.NEW &&
      !existing.studentId
    ) {
      // Создаём студента только если email уникален (он обязателен для ЛК)
      // Старый флоу (без email) — пропускаем, студент создастся при отдельном действии
      let studentId = existing.studentId;
      try {
        // Проблема D аудита: копируем managerId/chinaManagerId с заявки —
        // иначе авто-созданный студент рождается «бесхозным», даже если
        // заявку уже назначили конкретному менеджеру.
        //
        // Фолбэк на user.id: публичная заявка с лендинга создаётся вообще без
        // менеджеров (её может взять любой), поэтому копировать было бы нечего
        // и студент снова родился бы бесхозным — а «свободная» карточка
        // доступна на чтение, правку и удаление любому сотруднику.
        // Владелец по умолчанию — тот, кто двигает заявку на DOCS_REVIEW.
        // Переназначить его потом может FOUNDER или ADMIN.
        const studentData: any = {
          fullName: existing.fullName,
          phones: [existing.phone],
          // ТЗ v3 раздел 1. Это ОСНОВНОЙ путь появления студента в CRM —
          // заявка переходит в DOCS_REVIEW и превращается в карточку. Без
          // явной установки поле осталось бы null, и такой студент НЕ находился
          // бы по телефону нигде: и students, и договоры, и гранты, и билеты
          // ищут исключительно по phoneSearch. Отказ был бы молчаливым —
          // ничего не падает, в логах пусто, просто поиск не находит.
          phoneSearch: buildPhoneSearch([existing.phone]),
          email: existing.email,
          direction: existing.direction,
          cabinet: CABINET_BY_DIRECTION[existing.direction],
          comment: existing.comment,
          managerId: existing.managerId ?? user.id,
          chinaManagerId: existing.chinaManagerId,
        };
        const student = await this.prisma.student.create({ data: studentData });
        studentId = student.id;
      } catch (e) {
        // Ожидаемый случай — студент с таким email уже есть (P2002 по
        // Student.email): переводим статус без создания, это норма.
        // ЛЮБАЯ ДРУГАЯ ошибка (пул БД, нарушение FK, таймаут) раньше глоталась
        // здесь молча: заявка уезжала в DOCS_REVIEW без карточки студента, и
        // об этом не узнавал ни менеджер, ни лог. Теперь неожиданные ошибки
        // попадают в лог с id заявки — статус всё равно переводим (потерять
        // действие пользователя из-за сбоя создания студента хуже, карточку
        // добьёт кнопка «Создать заявку» в students.ensureApplication).
        const isDuplicateEmail = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!isDuplicateEmail) {
          this.logger.error(
            `Не удалось авто-создать студента по заявке ${id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const updated = await this.prisma.application.update({
        where: { id },
        data: { ...updateData, ...(studentId ? { studentId } : {}) },
        include: MANAGER_INCLUDE,
      });
      if (leavingNew) {
        await claimFirstTouch(this.prisma, updated.id, updated.managerId, user.id);
      }
      // Проблема B аудита: раньше сюда летел весь `updated` с MANAGER_INCLUDE
      // (паспортные данные, дата рождения, phones, email вложенного student) —
      // ВСЕМ сотрудникам в комнате staff. Теперь только id + маршрутизация
      // по фактическим менеджерам заявки (emitForStudent), фронт (Applications.tsx,
      // ApplicationDetail.tsx) перезапрашивает данные по HTTP с уже проверенными правами.
      this.realtime.emitForStudent(updated, 'application:updated', { id: updated.id, studentId: updated.studentId });
      if (updated.studentId) {
        this.realtime.emitStudent(updated.studentId, 'student:updated', { studentId: updated.studentId });
      }
      // SMS студенту: статус изменился на «Документы на проверке»
      const text = this.smsTextForStatus(existing.status, ApplicationStatus.DOCS_REVIEW);
      this.resolvePhone(updated).then((phone) => {
        if (phone) this.sms.send(phone, text).catch(() => undefined);
      }).catch(() => undefined);

      // ActivityLog
      this.activity
        .log({
          actorId: user.id,
          actorName: '',
          actorRole: user.role,
          action: 'STATUS_CHANGE',
          studentId: updated.studentId,
          studentName: updated.fullName,
          details: `Статус: ${existing.status} → ${updated.status}`,
        })
        .catch(() => undefined);
      this.logSourceChange(existing, dto, updated, user);
      return updated;
    }

    // Гейт DOCS_SUBMITTED удалён по запросу: менеджер должен иметь возможность
    // переводить заявку на следующий этап даже если не все документы загружены
    // (документы могут быть переданы по другим каналам, или клиент просит
    // двигаться дальше). Список недостающих документов всё ещё доступен для
    // справки через `missingRequiredDocs` и UI-предупреждение в CRM.

    const updated = await this.prisma.application.update({
      where: { id },
      data: updateData,
      include: MANAGER_INCLUDE,
    });
    if (leavingNew) {
      await claimFirstTouch(this.prisma, updated.id, updated.managerId, user.id);
    }
    // Раздел 5 ТЗ (волна 6) — метрика KPI «доведён до зачисления» (ТЗ 5.1).
    // НЕОБРАТИМА: claimEnrolled ставится claim-апдейтом (WHERE enrolledAt: null),
    // откат статуса назад её не обнуляет — «дошёл хотя бы раз» это факт истории.
    if (dto.status && dto.status !== existing.status && (updated.status === 'ENROLLED' || updated.status === 'COMPLETED')) {
      await claimEnrolled(this.prisma, updated.id, updated.managerId, user.id);
    }
    // Проблема B аудита: было {application: updated} с полными данными
    // студента ВСЕМ сотрудникам — теперь id + маршрутизация по реальным
    // менеджерам заявки, студент получает то же событие в свой канал
    // (StudentCabinet.tsx слушает application:updated).
    this.realtime.emitForStudent(
      updated,
      'application:updated',
      { id: updated.id, studentId: updated.studentId },
      updated.studentId ? { studentId: updated.studentId } : undefined,
    );
    if (updated.studentId) {
      this.realtime.emitStudent(updated.studentId, 'student:updated', { studentId: updated.studentId });
    }

    // SMS студенту при ЛЮБОЙ смене статуса (вперёд/назад/на ENROLLED)
    if (dto.status && dto.status !== existing.status) {
      const text = this.smsTextForStatus(existing.status, dto.status);
      this.resolvePhone(updated).then((phone) => {
        if (phone) this.sms.send(phone, text).catch(() => undefined);
      }).catch(() => undefined);
    }

    // ActivityLog для смены статуса
    if (dto.status && dto.status !== existing.status) {
      this.activity
        .log({
          actorId: user.id,
          actorName: '',
          actorRole: user.role,
          action: 'STATUS_CHANGE',
          studentId: updated.studentId,
          studentName: updated.fullName,
          details: `Статус: ${existing.status} → ${dto.status}`,
        })
        .catch(() => undefined);
    }

    this.logSourceChange(existing, dto, updated, user);
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
    const existing = await this.findOne(id);

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

    // Синхронизируем менеджеров на связанном студенте
    if (existing.studentId && Object.keys(data).length > 0) {
      await this.prisma.student.update({
        where: { id: existing.studentId },
        data,
      });
      // Проблема 7 аудита волны 1: переназначение менеджера через заявку
      // тоже меняет managerId/chinaManagerId связанного студента — сбрасываем
      // тот же приватный кэш FileResolverService, что и students.assignManager().
      this.fileResolver.invalidateForStudent(existing.studentId);
    }

    const updated = await this.prisma.application.update({
      where: { id },
      data,
      include: MANAGER_INCLUDE,
    });
    // Роутим по НОВЫМ менеджерам — старый менеджер (если сменился) перестаёт
    // получать события по этой заявке, что соответствует hasAccess() (он
    // больше не видит её и через HTTP).
    this.realtime.emitForStudent(updated, 'application:updated', { id: updated.id, studentId: updated.studentId });
    if (updated.studentId) {
      this.realtime.emitStudent(updated.studentId, 'student:updated', { studentId: updated.studentId });
    }

    // ActivityLog + уведомление о смене менеджера
    const beforeManager = existing.manager?.fullName || '—';
    const afterManager = updated.manager?.fullName || '—';
    const beforeChina = existing.chinaManager?.fullName || '—';
    const afterChina = updated.chinaManager?.fullName || '—';
    const detailsParts: string[] = [];
    if (patch.managerId !== undefined && existing.managerId !== updated.managerId) {
      detailsParts.push(`Менеджер 🇹🇯: ${beforeManager} → ${afterManager}`);
    }
    if (patch.chinaManagerId !== undefined && existing.chinaManagerId !== updated.chinaManagerId) {
      detailsParts.push(`Менеджер 🇨🇳: ${beforeChina} → ${afterChina}`);
    }
    if (detailsParts.length > 0) {
      const details = detailsParts.join('; ');
      this.activity
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: 'MANAGER_CHANGE',
          studentId: updated.studentId,
          studentName: updated.fullName,
          details,
        })
        .catch(() => undefined);

      // Уведомление о переназначении — только FOUNDER+ADMIN+новые/старые
      // менеджеры заявки. EMPLOYEE без отношения к заявке не получит
      // (иначе кликнет на уведомление и получит 403 на странице заявки).
      this.notifications
        .notifyForApplication(updated.id, {
          type: 'MANAGER_CHANGE',
          title: 'Менеджер изменён',
          message: `${updated.fullName}: ${details}`,
          payload: { applicationId: updated.id, studentId: updated.studentId },
        })
        .catch(() => undefined);
    }

    return updated;
  }

  /**
   * ТЗ 3.1 — ручной архив. Архив НЕ удаление: deletedAt не трогаем, данные
   * остаются полностью на месте и доступны через вкладку «Архив» / GET по id.
   * Права — те же, что на редактирование заявки (назначенные менеджеры +
   * FOUNDER/ADMIN): операция полностью обратима, злоупотребление ловится
   * журналом активности.
   */
  async archive(id: string, reason: string | undefined, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);
    if (existing.archivedAt) {
      throw new ConflictException('Заявка уже в архиве');
    }
    const trimmedReason = reason?.trim() || '';
    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        archivedById: user.id,
        archiveReason: trimmedReason ? `MANUAL: ${trimmedReason}` : 'MANUAL',
      },
      include: MANAGER_INCLUDE,
    });
    // Раздел 5 ТЗ (волна 6) — «архивация с ручной причиной» тоже считается
    // обработкой лида (ТЗ 5.1): отказ — это отработанный лид, а не забытый.
    // ТОЛЬКО ручной архив (эта функция), НЕ авто-архив джобы — см. common/lead-touch.ts.
    await claimFirstTouch(this.prisma, updated.id, updated.managerId, user.id);
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'APPLICATION_ARCHIVE',
        studentId: updated.studentId,
        studentName: updated.fullName,
        details: trimmedReason ? `Заявка отправлена в архив: ${trimmedReason}` : 'Заявка отправлена в архив',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      updated,
      'application:updated',
      { id: updated.id, studentId: updated.studentId },
      updated.studentId ? { studentId: updated.studentId } : undefined,
    );
    return updated;
  }

  /** ТЗ 3.1 — «Вернуть из архива»: archivedAt = null, данные не трогаются. */
  async unarchive(id: string, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);
    if (!existing.archivedAt) {
      throw new ConflictException('Заявка не в архиве');
    }
    const updated = await this.prisma.application.update({
      where: { id },
      data: { archivedAt: null, archivedById: null, archiveReason: null },
      include: MANAGER_INCLUDE,
    });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'APPLICATION_UNARCHIVE',
        studentId: updated.studentId,
        studentName: updated.fullName,
        details: 'Заявка возвращена из архива',
      })
      .catch(() => undefined);
    this.realtime.emitForStudent(
      updated,
      'application:updated',
      { id: updated.id, studentId: updated.studentId },
      updated.studentId ? { studentId: updated.studentId } : undefined,
    );
    return updated;
  }

  /**
   * ТЗ 3.1 — эвристика по телефону/email ГАРАНТИРОВАННО даёт ложные
   * срабатывания (общий номер на семью). «Не повторное» — обязательный
   * элемент: сбрасывает repeatOfId без каких-либо иных последствий.
   */
  async clearRepeat(id: string, user: CurrentUser) {
    const existing = await this.findOne(id);
    this.ensureCanEdit(existing, user);
    if (!existing.repeatOfId) return existing;
    const updated = await this.prisma.application.update({
      where: { id },
      data: { repeatOfId: null },
      include: MANAGER_INCLUDE,
    });
    this.activity
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: 'APPLICATION_CLEAR_REPEAT',
        studentId: updated.studentId,
        studentName: updated.fullName,
        details: 'Снята пометка «повторное обращение»',
      })
      .catch(() => undefined);
    return updated;
  }

  /**
   * ТЗ 3.1 — «Обращения с этого номера»: заявки с тем же phoneNormalized
   * (или тем же email, регистронезависимо), кроме самой заявки. IDOR-защита:
   * каждый элемент цепочки прогоняется через canAccessStudentRecord — те, на
   * которые у EMPLOYEE нет прав, схлопываются в hiddenCount БЕЗ ФИО и id.
   */
  async history(id: string, user: CurrentUser) {
    const app = await this.findOne(id, user);
    const or: Prisma.ApplicationWhereInput[] = [];
    if (app.phoneNormalized) or.push({ phoneNormalized: app.phoneNormalized });
    if (app.email) or.push({ email: { equals: app.email, mode: 'insensitive' } });
    if (!or.length) return { items: [], hiddenCount: 0 };

    const [chain, consultations] = await Promise.all([
      this.prisma.application.findMany({
        where: { deletedAt: null, id: { not: id }, OR: or },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          status: true,
          createdAt: true,
          source: true,
          managerId: true,
          chinaManagerId: true,
        },
      }),
      app.phoneNormalized
        ? this.prisma.consultation.findMany({
            where: { deletedAt: null, phoneNormalized: app.phoneNormalized, applicationId: { not: id } },
            orderBy: { heldAt: 'desc' },
            select: {
              id: true,
              fullName: true,
              kind: true,
              heldAt: true,
              source: true,
              managerId: true,
            },
          })
        : Promise.resolve([]),
    ]);

    type HistoryItem = {
      id: string;
      kind: 'application' | 'consultation';
      fullName: string;
      status: string | null;
      createdAt: Date;
      source: string | null;
    };
    const items: HistoryItem[] = [];
    let hiddenCount = 0;

    for (const c of chain) {
      if (canAccessStudentRecord(c, user)) {
        items.push({
          id: c.id,
          kind: 'application',
          fullName: c.fullName,
          status: c.status,
          createdAt: c.createdAt,
          source: c.source,
        });
      } else {
        hiddenCount += 1;
      }
    }
    for (const c of consultations) {
      if (canAccessStudentRecord({ managerId: c.managerId }, user)) {
        items.push({
          id: c.id,
          kind: 'consultation',
          fullName: c.fullName,
          // У консультации нет статуса заявки — вместо него отдаём тип
          // (консультация/собеседование), UI различает по kind.
          status: c.kind,
          createdAt: c.heldAt,
          source: c.source,
        });
      } else {
        hiddenCount += 1;
      }
    }
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return { items, hiddenCount };
  }

  private async missingRequiredDocs(studentId: string): Promise<string[]> {
    const docs = await this.prisma.document.findMany({
      where: { studentId },
      select: { type: true },
    });
    const uploaded = new Set(docs.map((d) => d.type));
    return REQUIRED_DOCUMENT_TYPES.filter((t) => !uploaded.has(t.type)).map((t) => t.label);
  }

  /**
   * Soft delete: помечаем deletedAt. Если у заявки есть студент — его
   * тоже soft-delete'им, НО только если права на СТУДЕНТА подтверждены
   * отдельно. Данные остаются в БД и могут быть восстановлены.
   */
  async remove(id: string, user: CurrentUser) {
    const app = await this.findOne(id);
    this.ensureCanEdit(app, user);
    const now = new Date();
    if (app.studentId && app.student) {
      // Проблема D аудита: раньше право удалить студента проверялось ЧЕРЕЗ
      // ПРАВА НА ЗАЯВКУ — а у заявки и у связанного студента могут быть
      // разные менеджеры (переназначить можно любую из сторон отдельно,
      // плюс исторические записи, заведённые до этой правки). Рядовой
      // менеджер, имея право редактировать «свою» заявку, мог тем самым
      // soft-delete'нуть ЧУЖОГО студента. Теперь права на студента
      // проверяются отдельно; нет прав — удаляем только заявку.
      if (canAccessStudentRecord(app.student, user)) {
        await this.prisma.student
          .update({ where: { id: app.studentId }, data: { deletedAt: now } })
          .catch(() => undefined);
        // БАГ 4 аудита: сбрасываем кэш StudentJwtGuard сразу, иначе
        // удалённый студент ещё до 30 секунд может ходить в ЛК по старому токену.
        invalidateStudentCache(app.studentId);
        // Проблема 7 аудита волны 1: тот же soft-delete студента, что и в
        // students.service.ts remove() — сбрасываем приватный кэш файлов.
        this.fileResolver.invalidateForStudent(app.studentId);
      }
    }
    await this.prisma.application
      .update({ where: { id }, data: { deletedAt: now } })
      .catch(() => undefined);
    this.realtime.emitForStudent(app, 'application:deleted', { id });
    return { ok: true };
  }

  async stats(user?: { id: string; role: Role }) {
    // Soft-delete + не в архиве: список по умолчанию (вкладка «Все») тоже
    // исключает архивные (см. tabCondition('all')) — если дашборд считать
    // иначе, числа между ним и списком разойдутся (риск 6 проекта архитектора).
    const scope: Prisma.ApplicationWhereInput =
      user && user.role === 'EMPLOYEE'
        ? { OR: [{ managerId: user.id }, { chinaManagerId: user.id }] }
        : {};
    const where: Prisma.ApplicationWhereInput = { deletedAt: null, archivedAt: null, ...scope };
    const [total, byStatus, byDirection, archived] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.groupBy({ by: ['status'], _count: true, where }),
      this.prisma.application.groupBy({ by: ['direction'], _count: true, where }),
      this.prisma.application.count({ where: { deletedAt: null, archivedAt: { not: null }, ...scope } }),
    ]);
    return { total, byStatus, byDirection, archived };
  }
}
