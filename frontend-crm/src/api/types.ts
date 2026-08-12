export type Role = 'FOUNDER' | 'ADMIN' | 'EMPLOYEE';

/**
 * ТЗ v3 раздел 4 — регион менеджера. Зеркало enum Region из schema.prisma.
 * Значим только для EMPLOYEE: Основатель и Администратор по ТЗ видят всех
 * студентов и Таджикистана, и Китая независимо от региона.
 */
export type Region = 'TJ' | 'CN' | 'BOTH';

export const REGION_LABEL: Record<Region, string> = {
  TJ: 'Таджикистан',
  CN: 'Китай',
  BOTH: 'Оба региона',
};

/** Пояснения к регионам на странице /users — чтобы не гадать, что изменится. */
export const REGION_DESCRIPTION: Record<Region, string> = {
  TJ: 'Видит только студентов, где он назначен менеджером по Таджикистану. Проводит платежи по ним.',
  CN: 'Видит только студентов, где он назначен менеджером по Китаю. Проводит платежи по ним.',
  BOTH: 'Видит студентов по обоим направлениям. Значение по умолчанию — так работала система до разделения по регионам.',
};

// badge-gray, а не badge-secondary: класса .badge-secondary в index.css нет,
// и бейдж отрендерился бы без заливки — просто жирным текстом в потоке.
export const REGION_BADGE: Record<Region, string> = {
  TJ: 'badge-info',
  CN: 'badge-warning',
  BOTH: 'badge-gray',
};

/**
 * ТЗ раздел 2 требует именно «Менеджер» для роли EMPLOYEE — в БД значение
 * enum НЕ переименовываем (это только подпись для интерфейса). Все места,
 * где роль показывается пользователю, обязаны брать подпись отсюда, а не
 * хардкодить строку — иначе часть экрана будет говорить «Сотрудник».
 */
export const ROLE_LABEL: Record<Role, string> = {
  FOUNDER: 'Основатель',
  ADMIN: 'Администратор',
  EMPLOYEE: 'Менеджер',
};

/** Короткое пояснение роли — используется на странице /users, чтобы отличие
 *  Основателя от Администратора было понятно без чтения ТЗ. */
export const ROLE_DESCRIPTION: Record<Role, string> = {
  FOUNDER: 'Полный доступ ко всем разделам, финансовой аналитике и системным логам. Единолично подтверждает платежи и управляет правами Администраторов и Менеджеров.',
  ADMIN: 'Операционный контроль: заявки, студенты, задачи, программы. Не может менять права Основателя, удалять системные логи и в одиночку закрывать финансовые транзакции.',
  EMPLOYEE: 'Работает со своими лидами, заявками и карточками студентов. Видит только свой KPI и расчётный лист по зарплате.',
};

export const ROLE_BADGE: Record<Role, string> = {
  FOUNDER: 'badge-danger',
  ADMIN: 'badge-warning',
  EMPLOYEE: 'badge-info',
};

/**
 * "Привилегированная" роль — может видеть все заявки/студентов и
 * редактировать любые записи (FOUNDER + ADMIN).
 * EMPLOYEE — только свои назначенные.
 *
 * NB: для управления сотрудниками (страница /users → POST/PATCH/DELETE)
 * используется отдельная проверка `role === 'FOUNDER'` напрямую,
 * потому что ADMIN там только read-only.
 */
export const isPrivileged = (role?: Role | null): boolean =>
  role === 'FOUNDER' || role === 'ADMIN';

/**
 * true только для FOUNDER. Двухстороннее подтверждение платежей (ТЗ 1.1)
 * запрещает ADMIN'у одобрять/отклонять/аннулировать — кнопки этих действий
 * должны показываться ТОЛЬКО когда isFounder(me?.role) истинно. Показ кнопки,
 * ведущей к 403 (ADMIN видит, но бэкенд отклоняет), запрещён по правилам проекта.
 */
export const isFounder = (role?: Role | null): boolean => role === 'FOUNDER';

/**
 * ТЗ v3 раздел 4, критерий приёмки №4 — «Администратор имеет доступ к финансам
 * СТРОГО в режиме Read-Only». Зеркало canWriteFinance() из
 * backend/src/common/roles.ts: любое расхождение между этими двумя функциями
 * означает либо кнопку, ведущую в 403, либо скрытую кнопку у того, кому она
 * положена.
 *
 * Используется для показа/скрытия кнопок «Внести оплату», «Редактировать»,
 * «Подать», «Отозвать», «Удалить», «Оформить договор» и т.п. Показ кнопки,
 * ведущей к 403, запрещён правилами проекта — поэтому проверять надо здесь,
 * а не полагаться на ошибку с бэкенда.
 */
export const canWriteFinance = (role?: Role | null): boolean =>
  role === 'FOUNDER' || role === 'EMPLOYEE';

/**
 * Полное управление финансовым контуром — только Основатель: одобрение
 * платежей, график платежей, подписание/расторжение договоров, утверждение
 * зарплатных листов, формулы бонусов. Зеркало canManageFinance() на бэкенде.
 */
export const canManageFinance = (role?: Role | null): boolean => role === 'FOUNDER';

/**
 * Зеркало selfApprovalBlock() из backend/src/payments/payment-rules.ts.
 * Возвращает причину, по которой кнопка «Одобрить» должна быть недоступна,
 * либо null, если одобрять можно.
 *
 * ЗАЧЕМ ОБЩАЯ ФУНКЦИЯ. Это правило жило тремя рукописными копиями — в
 * Payments.tsx, в PaymentsSection.tsx и на бэкенде. Ровно из-за такой схемы
 * («список фильтрует, карточка нет») в проекте уже трижды расходились условия
 * доступа. Здесь цена расхождения — либо активная кнопка, отдающая 409, либо
 * серая кнопка у того, кому одобрять положено.
 *
 * Про Основателя: с 12.08.2026 запрет на него не распространяется — решение
 * владельца, развёрнуто описано в бэкендовом файле. Фронт обязан повторять
 * это ровно, а не «на всякий случай» блокировать больше.
 */
export const selfApprovalBlock = (
  payment: { createdById?: string | null; submittedById?: string | null },
  me: { id?: string; role?: Role | null } | null | undefined,
): string | null => {
  if (!me?.id) return null;
  if (me.role === 'FOUNDER') return null;
  if (payment.createdById && payment.createdById === me.id) {
    return 'Нельзя одобрить платёж, который вы сами внесли в систему';
  }
  if (payment.submittedById && payment.submittedById === me.id) {
    return 'Нельзя одобрить платёж, который вы сами подали на одобрение';
  }
  return null;
};

export type Direction =
  | 'BACHELOR'
  | 'MASTER'
  | 'LANGUAGE'
  | 'LANGUAGE_COLLEGE'
  | 'LANGUAGE_BACHELOR'
  | 'COLLEGE';
export type ApplicationStatus =
  | 'NEW'
  | 'DOCS_REVIEW'
  | 'DOCS_SUBMITTED'
  | 'PRE_ADMISSION'
  | 'AWAITING_PAYMENT'
  | 'ENROLLED'
  // legacy (migrated automatically)
  | 'IN_PROGRESS'
  | 'COMPLETED';

export const APPLICATION_STAGES: ApplicationStatus[] = [
  'NEW',
  'DOCS_REVIEW',
  'DOCS_SUBMITTED',
  'PRE_ADMISSION',
  'AWAITING_PAYMENT',
  'ENROLLED',
];

export const STAGE_INDEX: Record<ApplicationStatus, number> = {
  NEW: 0,
  DOCS_REVIEW: 1,
  IN_PROGRESS: 1, // legacy
  DOCS_SUBMITTED: 2,
  PRE_ADMISSION: 3,
  AWAITING_PAYMENT: 4,
  ENROLLED: 5,
  COMPLETED: 5, // legacy
};
export type StudentStatus = 'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'ARCHIVED';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /** ТЗ v3 р4. Необязательное — старый бэкенд поля не отдаёт, читать как BOTH. */
  region?: Region;
  createdAt?: string;
}

export interface ManagerInfo {
  id: string;
  fullName: string;
  email: string;
}

// ============================================================================
// ТЗ раздел 3.1 — источник привлечения. Единственный источник истины по
// значениям — backend/src/common/lead-source.ts, этот массив его зеркалит
// (порядок для UI задаётся здесь же). String, а не enum — см. обоснование
// в backend-схеме: список каналов будет расти (волна 7, Chat Place).
// ============================================================================
export interface LeadSourceOption {
  value: string;
  label: string;
}

export const LEAD_SOURCES: readonly LeadSourceOption[] = [
  { value: 'WEBSITE', label: 'Сайт' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'REFERRAL', label: 'Рекомендация (сарафан)' },
  { value: 'OFFICE_VISIT', label: 'Визит в офис' },
  { value: 'ADS', label: 'Реклама' },
  { value: 'OTHER', label: 'Другое' },
] as const;

export const LEAD_SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.label]),
);

/** Для старых заявок (229 исторических) и консультаций без источника — честное «Не указан», а не пустота. */
export function leadSourceLabel(source: string | null | undefined): string {
  if (!source) return 'Не указан';
  return LEAD_SOURCE_LABEL[source] ?? source;
}

/** ТЗ 3.1 — вкладки раздела «Заявки». 'all' — дефолт (см. applications.service.ts ApplicationTab). */
export type ApplicationTab = 'all' | 'new' | 'in_work' | 'archive';

export interface Application {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  direction: Direction;
  comment: string | null;
  status: ApplicationStatus;
  studentId: string | null;
  student?: Student | null;
  managerId: string | null;
  manager?: ManagerInfo | null;
  chinaManagerId: string | null;
  chinaManager?: ManagerInfo | null;
  /** ТЗ 3.1 — источник привлечения. null у исторических заявок ("Не указан"). */
  source: string | null;
  sourceDetail: string | null;
  /** ТЗ 3.1 — ручной/авто архив. Признак архивности — ЕДИНСТВЕННЫЙ: archivedAt !== null. */
  archivedAt: string | null;
  archivedById: string | null;
  archivedBy?: { id: string; fullName: string } | null;
  archiveReason: string | null;
  /** ТЗ 3.1 — «повторное обращение»: ссылка на первую заявку с тем же телефоном/email. */
  repeatOfId: string | null;
  phoneNormalized?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  type: string;
  createdAt: string;
}

export interface Student {
  id: string;
  fullName: string;
  phones: string[];
  email: string | null;
  photoUrl: string | null;
  direction: Direction;
  cabinet: number;
  status: StudentStatus;
  comment: string | null;
  /**
   * ТЗ v3 раздел 5 — «Виза получена: Да / Нет».
   *
   * НЕОБЯЗАТЕЛЬНОЕ намеренно, хотя в схеме стоит @default(false). На бэкенде
   * поле добавлено только в STUDENT_SELECT и STUDENT_LIST_SELECT — карточка и
   * список студентов, — и сознательно НЕ добавлено в общий STUDENT_SAFE_FIELDS,
   * которым наполняется вложенный студент внутри заявки. Обязательный тип
   * обещал бы boolean там, где в рантайме приходит undefined, и `undefined`
   * тихо отрисовался бы как «Виза не получена» у студента, который её получил.
   */
  visaReceived?: boolean;
  /** Момент отметки о визе; проставляется сервером. null — визы ещё нет. */
  visaReceivedAt?: string | null;
  /**
   * ТЗ «Разделение воронок» (backend e143a7d) — момент передачи студента в
   * китайский офис. null/undefined — студент ещё ведётся Таджикистаном.
   * По этому же полю сервер решает доступ китайского менеджера к карточке
   * (hasAccess): пока оно пустое, региональный CN-сотрудник карточку не
   * видит вовсе, даже если chinaManagerId уже проставлен «на будущее».
   * Дата первой передачи НЕ переписывается при смене получателя в Китае —
   * поэтому клиент её тоже не имеет права предсказывать заново при повторной
   * передаче (см. ChinaTransferModal / StudentDetail.onTransferToChina).
   */
  transferredToChinaAt?: string | null;
  managerId: string | null;
  manager?: ManagerInfo | null;
  chinaManagerId: string | null;
  chinaManager?: ManagerInfo | null;
  applicationForm?: any;
  documents?: Document[];
  applications?: Application[];
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  payload: any;
  read: boolean;
  createdAt: string;
}

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedToId: string;
  assignedTo?: { id: string; fullName: string; email: string };
  createdById: string | null;
  createdBy?: { id: string; fullName: string; email: string } | null;
  /** ТЗ 3.2 — дата и время повторного звонка / срок задачи. null — срок не задан. */
  dueDate: string | null;
  /** Ключ идемпотентности автозадач ('consultation-followup:<id>' и т.п.). null у ручных задач. */
  originKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'К выполнению',
  IN_PROGRESS: 'В работе',
  DONE: 'Выполнено',
};

export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  TODO: 'badge-info',
  IN_PROGRESS: 'badge-warning',
  DONE: 'badge-success',
};

export const DIRECTION_LABEL: Record<Direction, string> = {
  BACHELOR: 'Бакалавриат',
  MASTER: 'Магистратура',
  LANGUAGE: 'Языковые курсы',
  LANGUAGE_COLLEGE: 'Языковой + колледж',
  LANGUAGE_BACHELOR: 'Языковой + бакалавриат',
  COLLEGE: 'Колледж',
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  NEW: 'Новая заявка',
  DOCS_REVIEW: 'Документы на проверке',
  DOCS_SUBMITTED: 'Подача документов',
  PRE_ADMISSION: 'Предварительное зачисление',
  AWAITING_PAYMENT: 'Ожидание оплаты',
  ENROLLED: 'Зачислен',
  IN_PROGRESS: 'Документы на проверке',
  COMPLETED: 'Зачислен',
};

export const STATUS_SHORT: Record<ApplicationStatus, string> = {
  NEW: 'Новая',
  DOCS_REVIEW: 'Проверка',
  DOCS_SUBMITTED: 'Подача',
  PRE_ADMISSION: 'Предв. зачисление',
  AWAITING_PAYMENT: 'Оплата',
  ENROLLED: 'Зачислен',
  IN_PROGRESS: 'Проверка',
  COMPLETED: 'Зачислен',
};

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  ACTIVE: 'Активный',
  PAUSED: 'Приостановлен',
  GRADUATED: 'Выпустился',
  ARCHIVED: 'В архиве',
};

export const STATUS_BADGE: Record<ApplicationStatus, string> = {
  NEW: 'badge-info',
  DOCS_REVIEW: 'badge-warning',
  DOCS_SUBMITTED: 'badge-warning',
  PRE_ADMISSION: 'badge-info',
  AWAITING_PAYMENT: 'badge-warning',
  ENROLLED: 'badge-success',
  IN_PROGRESS: 'badge-warning',
  COMPLETED: 'badge-success',
};

export const STUDENT_STATUS_BADGE: Record<StudentStatus, string> = {
  ACTIVE: 'badge-success',
  PAUSED: 'badge-warning',
  GRADUATED: 'badge-info',
  ARCHIVED: 'badge-gray',
};

// ============================================================================
// ТЗ раздел 3.2 — «база данных консультаций и собеседований». Контракт
// зеркалит backend/src/consultations/ (CONSULTATION_INCLUDE в
// consultations.service.ts) — GET/POST/PATCH /consultations.
// ============================================================================

export type ConsultationKind = 'CONSULTATION' | 'INTERVIEW';

/** «Решение клиента», фиксируется ПОСЛЕ повторного звонка. null — звонок ещё не состоялся/не обработан. */
export type ConsultationOutcome = 'THINKING' | 'AGREED' | 'REFUSED' | 'UNREACHABLE';

export const CONSULTATION_KIND_LABEL: Record<ConsultationKind, string> = {
  CONSULTATION: 'Консультация',
  INTERVIEW: 'Собеседование',
};

export const CONSULTATION_OUTCOME_LABEL: Record<ConsultationOutcome, string> = {
  THINKING: 'Думает',
  AGREED: 'Согласен',
  REFUSED: 'Отказ',
  UNREACHABLE: 'Не дозвонились',
};

export const CONSULTATION_OUTCOME_BADGE: Record<ConsultationOutcome, string> = {
  THINKING: 'badge-warning',
  AGREED: 'badge-success',
  REFUSED: 'badge-danger',
  UNREACHABLE: 'badge-gray',
};

export interface ConsultationLinkedApplication {
  id: string;
  status: ApplicationStatus;
  fullName: string;
}

export interface ConsultationLinkedStudent {
  id: string;
  fullName: string;
}

export interface Consultation {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string | null;
  purpose: string;
  kind: ConsultationKind;
  outcome: ConsultationOutcome | null;
  source: string | null;
  sourceDetail: string | null;
  direction: Direction | null;
  comment: string | null;
  /** Когда консультация ФАКТИЧЕСКИ проведена (не момент ввода в CRM). */
  heldAt: string;
  managerId: string | null;
  manager?: ManagerInfo | null;
  createdById: string | null;
  createdBy?: { id: string; fullName: string } | null;
  applicationId: string | null;
  application?: ConsultationLinkedApplication | null;
  studentId: string | null;
  student?: ConsultationLinkedStudent | null;
  /** ТЗ 3.2 — дата и время повторного звонка. При заполнении синхронно создаётся задача (Task.originKey). */
  followUpAt: string | null;
  followUpTaskId: string | null;
  reminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Финансы (ТЗ раздел 1): двухстороннее подтверждение платежей + поэтапная
// система оплаты + детализация транзакции. Реальный контракт — в
// backend/src/payments/ (payments.controller.ts, payments.service.ts,
// payment-rules.ts) и backend/prisma/schema.prisma — эти типы их зеркалят.
// ============================================================================

/**
 * Плоский список из 6 самостоятельных платежей (не иерархия) — порядок
 * отображения задаёт stageOrder, а НЕ порядок объявления значений здесь
 * (см. backend/src/payments/payment-rules.ts STAGE_ORDER).
 */
export type PaymentStage =
  | 'INITIAL'
  | 'REGISTRATION'
  | 'DOCUMENTATION'
  | 'ENROLLMENT'
  | 'RELOCATION'
  | 'LIVING_EXPENSES';

/** SCHEDULE — разовые платежи по графику (этапы 1–3), ON_SITE — расходы на месте (этап 4). */
export type PaymentKind = 'SCHEDULE' | 'ON_SITE';

/**
 * ТЗ v3 раздел 3 — пять действующих типов оплат плюс историческе значения,
 * которые остаются в базе ради читаемости старых записей. Зеркало enum
 * PaymentPurpose из schema.prisma: тип обязан перечислять ВСЕ значения, иначе
 * PAYMENT_PURPOSE_LABEL[p.purpose] вернёт undefined и колонка «Назначение»
 * у старого платежа станет пустой.
 */
export type PaymentPurpose =
  // Действующие (ТЗ v3 р3)
  | 'PREPAYMENT'
  | 'UNIVERSITY_REGISTRATION'
  | 'DOCUMENTATION'
  | 'FULL_PAYMENT'
  | 'TUITION_ACCOMMODATION'
  // Историческе — только для чтения уже сохранённых платежей
  | 'REGISTRATION'
  | 'ENROLLMENT'
  | 'RELOCATION'
  | 'ACCOMMODATION'
  | 'FOOD'
  | 'CONSULTATION'
  | 'OTHER';

export type PaymentMethod = 'CASH' | 'CASHLESS';

/** Double Check (ТЗ 1.1): деньги считаются полученными ТОЛЬКО в APPROVED. */
export type PaymentStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'VOID';

export const PAYMENT_STAGE_ORDER: Record<PaymentStage, number> = {
  INITIAL: 1,
  REGISTRATION: 2,
  DOCUMENTATION: 3,
  ENROLLMENT: 4,
  RELOCATION: 5,
  LIVING_EXPENSES: 6,
};

/** Зеркало backend STAGE_KIND — источник истины для UI-подсказок; сервер перепроверяет всё сам. */
export const PAYMENT_STAGE_KIND: Record<PaymentStage, PaymentKind> = {
  INITIAL: 'SCHEDULE',
  REGISTRATION: 'SCHEDULE',
  DOCUMENTATION: 'SCHEDULE',
  ENROLLMENT: 'SCHEDULE',
  RELOCATION: 'SCHEDULE',
  LIVING_EXPENSES: 'ON_SITE',
};

/** Этапы «Графика платежей» (без LIVING_EXPENSES — у расходов на месте плана нет). */
export const SCHEDULE_PAYMENT_STAGES: PaymentStage[] = [
  'INITIAL',
  'REGISTRATION',
  'DOCUMENTATION',
  'ENROLLMENT',
  'RELOCATION',
];

export const PAYMENT_STAGE_LABEL: Record<PaymentStage, string> = {
  INITIAL: 'Этап 1. Первичная оплата',
  REGISTRATION: 'Этап 1.1. Регистрация студента',
  DOCUMENTATION: 'Этап 2. Документация (виза, приглашение)',
  ENROLLMENT: 'Этап 2.1. После зачисления',
  RELOCATION: 'Этап 3. После переезда в Китай',
  LIVING_EXPENSES: 'Этап 4. Расходы на месте',
};

export const PAYMENT_STAGE_SHORT: Record<PaymentStage, string> = {
  INITIAL: 'Этап 1',
  REGISTRATION: 'Этап 1.1',
  DOCUMENTATION: 'Этап 2',
  ENROLLMENT: 'Этап 2.1',
  RELOCATION: 'Этап 3',
  LIVING_EXPENSES: 'Этап 4',
};

export const PAYMENT_PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  // Пять пунктов ТЗ v3 — порядок совпадает с порядком в выпадающем списке.
  PREPAYMENT: 'Предоплата',
  UNIVERSITY_REGISTRATION: 'Оплата за регистрацию в университете',
  DOCUMENTATION: 'Документация',
  FULL_PAYMENT: 'Полная оплата',
  TUITION_ACCOMMODATION: 'Оплата за обучение и проживание',
  // Историческе — подписи НЕ переименованы: старый платёж обязан показывать
  // ровно то, чем он был, а не подставленное новое название.
  REGISTRATION: 'Регистрация студента',
  ENROLLMENT: 'Зачисление в университет',
  RELOCATION: 'После переезда',
  ACCOMMODATION: 'Проживание',
  FOOD: 'Питание',
  CONSULTATION: 'Консультация',
  OTHER: 'Другое',
};

/**
 * ТЗ v3 раздел 4, графа «Права по финансовой части» — какие типы оплат
 * менеджер данного региона может ПРОВЕСТИ. Зеркало PURPOSES_BY_REGION из
 * backend/src/payments/payment-rules.ts.
 *
 * Дословно из таблицы: у менеджера Китая перечислено три пункта, причём
 * «Оплата за регистрацию в университете» — с пометкой «только просмотр», то
 * есть провести он может два. У менеджера Таджикистана перечня типов нет
 * вовсе — значит и ограничения нет.
 *
 * UNIVERSITY_REGISTRATION не входит ни в один региональный список: это и есть
 * «право проведения только у Основателя» из раздела 3.
 *
 * Недоступный пункт обязан ИСЧЕЗАТЬ из выпадающего списка, а не быть выбранным
 * и отбитым 403 при сохранении: вести человека к предсказуемой ошибке нельзя.
 */
export const PAYMENT_PURPOSES_BY_REGION: Record<Region, PaymentPurpose[]> = {
  CN: ['PREPAYMENT', 'TUITION_ACCOMMODATION'],
  TJ: ['PREPAYMENT', 'DOCUMENTATION', 'FULL_PAYMENT', 'TUITION_ACCOMMODATION'],
  BOTH: ['PREPAYMENT', 'DOCUMENTATION', 'FULL_PAYMENT', 'TUITION_ACCOMMODATION'],
};

/** Назначения, допустимые для расходов на месте (kind=ON_SITE) — зеркало backend payment-rules.ts. */
export const ON_SITE_PAYMENT_PURPOSES: PaymentPurpose[] = ['TUITION_ACCOMMODATION'];
/** Назначения, допустимые для платежей по графику (kind=SCHEDULE). */
export const SCHEDULE_PAYMENT_PURPOSES: PaymentPurpose[] = [
  'PREPAYMENT',
  'UNIVERSITY_REGISTRATION',
  'DOCUMENTATION',
  'FULL_PAYMENT',
  'TUITION_ACCOMMODATION',
];

/**
 * Список типов для выпадающего списка с учётом ЭТАПА, РОЛИ и РЕГИОНА.
 * Зеркало purposesForActor() на бэкенде — расхождение означало бы либо пункт,
 * ведущий в 403, либо спрятанный пункт у того, кому он положен.
 */
export function paymentPurposesFor(
  stage: PaymentStage,
  role?: Role | null,
  region?: Region | null,
): PaymentPurpose[] {
  const byStage =
    PAYMENT_STAGE_KIND[stage] === 'ON_SITE' ? ON_SITE_PAYMENT_PURPOSES : SCHEDULE_PAYMENT_PURPOSES;
  if (isFounder(role)) return byStage;
  // Администратор в финансах не пишет — форма ему и так недоступна, но список
  // не должен обещать ему пунктов, которых он не проведёт.
  if (role !== 'EMPLOYEE') return [];
  const byRegion = PAYMENT_PURPOSES_BY_REGION[region ?? 'BOTH'] ?? PAYMENT_PURPOSES_BY_REGION.BOTH;
  return byStage.filter((p) => byRegion.includes(p));
}

/**
 * Значение по умолчанию при выборе этапа. Ни одно из них не должно быть
 * пунктом «только для Основателя» — иначе форма у менеджера открывалась бы
 * с заранее невалидным выбором.
 */
export const DEFAULT_PAYMENT_PURPOSE: Record<PaymentStage, PaymentPurpose> = {
  INITIAL: 'PREPAYMENT',
  REGISTRATION: 'PREPAYMENT',
  DOCUMENTATION: 'DOCUMENTATION',
  ENROLLMENT: 'FULL_PAYMENT',
  RELOCATION: 'TUITION_ACCOMMODATION',
  LIVING_EXPENSES: 'TUITION_ACCOMMODATION',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Наличные',
  CASHLESS: 'Безналичный расчёт',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  DRAFT: 'Черновик',
  PENDING_APPROVAL: 'Ожидает одобрения Основателем',
  APPROVED: 'Проведён',
  REJECTED: 'Отклонён',
  VOID: 'Аннулирован',
};

export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  DRAFT: 'badge-gray',
  PENDING_APPROVAL: 'badge-warning',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
  VOID: 'badge-gray',
};

/** ТЗ 1.3: для этих назначений отсутствие чека СТРОГО блокирует сохранение — уже на создании. */
export const RECEIPT_REQUIRED_PURPOSES: PaymentPurpose[] = ['ACCOMMODATION', 'FOOD'];

/** До 10 цифр целой части, до 2 после точки — совпадает с backend AMOUNT_RE и Decimal(12,2). */
export const PAYMENT_AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;

export interface PaymentActor {
  id: string;
  fullName: string;
}

export interface PaymentStudentScope {
  id: string;
  fullName: string;
  managerId: string | null;
  chinaManagerId: string | null;
}

/**
 * Чек = Document{type:'RECEIPT'}, но payments.service.ts (PAYMENT_SELECT)
 * выбирает не все поля Document (в частности, без `type` — он константа
 * 'RECEIPT' по построению) — отдельный узкий тип, чтобы не обещать поле,
 * которого нет в ответе именно этого эндпоинта.
 */
export interface PaymentReceipt {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  studentId: string;
  student?: PaymentStudentScope;
  contractId: string | null;
  stage: PaymentStage;
  stageOrder: number;
  kind: PaymentKind;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  /** Decimal сериализован строкой на бэкенде ("12345.67") — арифметику на фронте не делать. */
  amount: string;
  currency: string;
  paidAt: string;
  dueDate: string | null;
  reference: string | null;
  comment: string | null;
  status: PaymentStatus;
  createdById: string | null;
  createdBy?: PaymentActor | null;
  submittedById: string | null;
  submittedBy?: PaymentActor | null;
  submittedAt: string | null;
  approvedById: string | null;
  approvedBy?: PaymentActor | null;
  approvedAt: string | null;
  rejectedById: string | null;
  rejectedBy?: PaymentActor | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  voidedById: string | null;
  voidedBy?: PaymentActor | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  receipts: PaymentReceipt[];
}

export interface PaymentScheduleRow {
  id: string;
  studentId: string;
  contractId: string | null;
  stage: PaymentStage;
  stageOrder: number;
  plannedAmount: string;
  currency: string;
  dueDate: string | null;
  comment: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PaymentStageSummary {
  stage: PaymentStage;
  label: string;
  stageOrder: number;
  plannedAmount: string;
  dueDate: string | null;
  /** Комментарий строки графика — без него модалка правки плана не может предзаполнить поле и стирает сохранённый текст. */
  comment: string | null;
  paidAmount: string;
  pendingAmount: string;
  remainingAmount: string;
  overdue: boolean;
  /** true для ENROLLMENT (Этап 2.1), пока студент не зачислен — см. enrollmentUnlocked. */
  locked: boolean;
  payments: Payment[];
}

export interface PaymentSummary {
  studentId: string;
  currency: string;
  enrollmentUnlocked: boolean;
  /** Раздел 5 ТЗ (волна 6) — id действующего (SIGNED) договора студента, null если его нет. */
  contractId: string | null;
  /**
   * ТЗ «Разделение воронок» — какие офисы видны сотруднику. stages уже
   * приходят отфильтрованными сервером, это поле сюда добавлено на будущее
   * (справочно): решение «показывать ли этап» принимает состав stages, а не
   * этот массив на фронте.
   */
  visibleOffices: ('TJ' | 'CN')[];
  /**
   * ТЗ «Разделение воронок» — показывать ли блок «Расходы на месте» вообще.
   * false для таджикского офиса: LIVING_EXPENSES ведёт только Китай. Именно
   * ФЛАГ, а не пустой/нулевой onSite — ноль читался бы как факт «трат нет»,
   * а таджикский менеджер вообще не должен знать эту цифру (см.
   * PaymentsSection.tsx).
   */
  onSiteVisible: boolean;
  stages: PaymentStageSummary[];
  onSite: {
    total: string;
    byPurpose: { ACCOMMODATION: string; FOOD: string; OTHER: string };
    payments: Payment[];
  };
  totals: {
    planned: string;
    paid: string;
    pending: string;
    remaining: string;
    overdueAmount: string;
  };
}

// ============================================================================
// Финансовая аналитика для руководства (ТЗ 2.6, FOUNDER + ADMIN).
// Контракт зеркалит backend/src/payments/finance-analytics.service.ts
// (FinanceAnalyticsSummary) — GET /payments/analytics/summary?from=&to=.
// ============================================================================

export type AnalyticsPeriodPreset = 'month' | 'quarter' | 'year' | 'custom';

/** Пара "сумма + количество" — базовая единица большинства срезов аналитики. */
export interface AnalyticsAmountCount {
  count: number;
  amount: string;
}

export interface AnalyticsStageBreakdown {
  stage: PaymentStage;
  label: string;
  count: number;
  amount: string;
}

export interface AnalyticsPurposeBreakdown {
  purpose: PaymentPurpose;
  label: string;
  count: number;
  amount: string;
}

export interface AnalyticsMethodBreakdown {
  method: PaymentMethod;
  label: string;
  count: number;
  amount: string;
}

/** «Кто сколько собрал» — по автору платежа (createdById), не по назначенному менеджеру студента. */
export interface AnalyticsManagerRow {
  managerId: string | null;
  managerName: string;
  count: number;
  amount: string;
}

/** Точка динамики по месяцам, month в формате "YYYY-MM", по возрастанию. */
export interface AnalyticsMonthPoint {
  month: string;
  count: number;
  amount: string;
}

export interface PaymentsAnalytics {
  currency: string;
  period: { from: string | null; to: string | null };
  /** Итого поступлений за период — учитываются ТОЛЬКО APPROVED (Double Check, ТЗ 1.1). */
  totalApproved: AnalyticsAmountCount;
  byStage: AnalyticsStageBreakdown[];
  byPurpose: AnalyticsPurposeBreakdown[];
  byMethod: AnalyticsMethodBreakdown[];
  /**
   * «Кто сколько собрал», поимённо. НЕОБЯЗАТЕЛЬНОЕ, и это не мелочь типизации.
   *
   * Бэкенд намеренно вырезает этот срез у Администратора
   * (finance-analytics.controller.ts): поимённые сборы — кадровая оценка, а в
   * волне 6 на этих же цифрах считается бонусная часть зарплаты. Решение
   * правильное, но тип обещал массив всегда, и страница читала `.map` без
   * проверки — у КАЖДОГО Администратора экран аналитики падал целиком с
   * «Cannot read properties of undefined (reading 'map')».
   *
   * Необязательный тип заставляет обрабатывать отсутствие явно.
   */
  byManager?: AnalyticsManagerRow[];
  monthly: AnalyticsMonthPoint[];
  /** Не зависит от периода — снимок текущей очереди на одобрение (как /payments/pending/count). */
  pendingApproval: AnalyticsAmountCount;
  /** Не зависит от периода — текущий срез: dueDate графика прошёл, а сумма не покрыта APPROVED-оплатами. */
  overdue: AnalyticsAmountCount;
  /** Не зависит от периода — сколько ещё должно прийти по всему графику (план минус уже одобренное). */
  plannedRemaining: { amount: string };
}

// ============================================================================
// Раздел 5 ТЗ (волна 6) — договоры, KPI менеджеров, зарплата (Payroll).
// Контракт зеркалит backend/src/contracts/ и backend/src/payroll/ — реальные
// формы ответов смотреть там же (эти типы намеренно узкие, под то, что
// реально отдают контроллеры, а не всю схему Prisma).
// ============================================================================

/**
 * РЕШЕНИЕ ЗАКАЗЧИКА: договор — ОТДЕЛЬНАЯ СУЩНОСТЬ, не статус заявки.
 * DRAFT — готовится, в KPI/зарплате не участвует. SIGNED — единственный
 * статус, дающий конверсию и бонус менеджеру. TERMINATED/COMPLETED — конечные.
 */
export type ContractStatus = 'DRAFT' | 'SIGNED' | 'TERMINATED' | 'COMPLETED';

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: 'Черновик',
  SIGNED: 'Подписан',
  TERMINATED: 'Расторгнут',
  COMPLETED: 'Исполнен',
};

export const CONTRACT_STATUS_BADGE: Record<ContractStatus, string> = {
  DRAFT: 'badge-gray',
  SIGNED: 'badge-success',
  TERMINATED: 'badge-danger',
  COMPLETED: 'badge-info',
};

export interface ContractStudentRef {
  id: string;
  fullName: string;
  managerId: string | null;
  chinaManagerId: string | null;
}

export interface ContractApplicationRef {
  id: string;
  fullName: string;
  status: ApplicationStatus;
}

export interface ContractActorRef {
  id: string;
  fullName: string;
}

export interface Contract {
  id: string;
  number: string;
  studentId: string;
  student: ContractStudentRef;
  applicationId: string | null;
  application: ContractApplicationRef | null;
  managerId: string | null;
  manager: ContractActorRef | null;
  status: ContractStatus;
  signedAt: string | null;
  signedById: string | null;
  signedBy: ContractActorRef | null;
  /** 'ACTIVE' пока status=SIGNED, иначе null — справочно, бизнес-логику по нему на фронте не строим. */
  activeSlot: string | null;
  terminatedAt: string | null;
  terminatedById: string | null;
  terminatedBy: ContractActorRef | null;
  terminationReason: string | null;
  /** Decimal сериализован строкой — арифметику на фронте не делать. */
  amount: string;
  currency: string;
  /** Веха «переезд» (ТЗ 5.1) — ставится автоматически при одобрении платежа этапа RELOCATION. */
  relocatedAt: string | null;
  note: string | null;
  createdById: string | null;
  createdBy: ContractActorRef | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Payroll (ТЗ 5.2) — зарплата менеджеров.
// ---------------------------------------------------------------------------

export type PayslipStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID';

export const PAYSLIP_STATUS_LABEL: Record<PayslipStatus, string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Утверждён',
  PAID: 'Выплачен',
  VOID: 'Аннулирован',
};

export const PAYSLIP_STATUS_BADGE: Record<PayslipStatus, string> = {
  DRAFT: 'badge-gray',
  APPROVED: 'badge-info',
  PAID: 'badge-success',
  VOID: 'badge-danger',
};

/** ЗАКРЫТЫЙ список типов бонусов — формула ВСЕГДА выбор типа + числа, никогда текст/выражение. */
export type BonusRuleKind =
  | 'PERCENT_OF_CONTRACTS'
  | 'PERCENT_OF_PAYMENTS'
  | 'FIXED_PER_CONTRACT'
  | 'FIXED_PER_STAGE'
  | 'FIXED_PER_ENROLLMENT'
  | 'FIXED_PER_RELOCATION'
  | 'FIXED_PER_CONSULTATION'
  | 'KPI_THRESHOLD_BONUS'
  | 'FIXED_PER_DOCUMENT';

export const BONUS_RULE_KIND_LABEL: Record<BonusRuleKind, string> = {
  PERCENT_OF_CONTRACTS: '% от суммы подписанных договоров',
  PERCENT_OF_PAYMENTS: '% от собранных платежей',
  FIXED_PER_CONTRACT: 'Фиксированная сумма за договор',
  FIXED_PER_STAGE: 'Фиксированная сумма за закрытый этап',
  FIXED_PER_ENROLLMENT: 'Фиксированная сумма за зачисление',
  FIXED_PER_RELOCATION: 'Фиксированная сумма за переезд',
  FIXED_PER_CONSULTATION: 'Фиксированная сумма за консультацию',
  KPI_THRESHOLD_BONUS: 'Премия за достижение порога KPI',
  // Доработка 12.08.2026. Считается по ТИПАМ документов (банк, медсправка,
  // судимость…), впервые появившимся у студентов менеджера за период —
  // повторные файлы того же типа бонус не дублируют (kpi.service.ts).
  FIXED_PER_DOCUMENT: 'Фиксированная сумма за документ студента',
};

export type KpiMetric =
  | 'LEADS_PROCESSED'
  | 'CONSULTATIONS_HELD'
  | 'CONTRACTS_SIGNED'
  | 'CONVERSION_RATE'
  | 'PAYMENT_TIMELINESS'
  | 'DELIVERY_RATE'
  | 'ENROLLED_COUNT'
  | 'RELOCATED_COUNT';

export const KPI_METRIC_LABEL: Record<KpiMetric, string> = {
  LEADS_PROCESSED: 'Обработанные лиды',
  CONSULTATIONS_HELD: 'Проведённые консультации',
  CONTRACTS_SIGNED: 'Подписанные договоры',
  CONVERSION_RATE: 'Конверсия в договор',
  PAYMENT_TIMELINESS: 'Своевременность оплат',
  DELIVERY_RATE: 'Доведение до зачисления',
  ENROLLED_COUNT: 'Зачислено',
  RELOCATED_COUNT: 'Переехало',
};

/** Метрики-доли (0..1) — в форме показываются и вводятся как проценты. Остальные — счётчики. */
export const KPI_RATE_METRICS: readonly KpiMetric[] = ['CONVERSION_RATE', 'PAYMENT_TIMELINESS', 'DELIVERY_RATE'];

export type BonusMetricScope = 'PERSONAL' | 'TEAM';

export const BONUS_METRIC_SCOPE_LABEL: Record<BonusMetricScope, string> = {
  PERSONAL: 'Личный показатель',
  TEAM: 'Командный показатель',
};

export type BonusRuleScope = 'ALL' | 'USER';

export const BONUS_RULE_SCOPE_LABEL: Record<BonusRuleScope, string> = {
  ALL: 'Все сотрудники',
  USER: 'Персонально',
};

export type BonusRuleSetStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export const BONUS_RULE_SET_STATUS_LABEL: Record<BonusRuleSetStatus, string> = {
  DRAFT: 'Черновик',
  ACTIVE: 'Действует',
  ARCHIVED: 'В архиве',
};

export const BONUS_RULE_SET_STATUS_BADGE: Record<BonusRuleSetStatus, string> = {
  DRAFT: 'badge-gray',
  ACTIVE: 'badge-success',
  ARCHIVED: 'badge-warning',
};

/**
 * Одно правило бонуса. rate/threshold — «сырые» доли/числа СТРОКОЙ, как их
 * отдаёт RulesService (см. backend/src/payroll/rules.service.ts money()) —
 * НЕ проценты. Конвертацию в проценты для формы делает сама форма правила.
 */
export interface BonusRule {
  id: string;
  ruleSetId: string;
  kind: BonusRuleKind;
  label: string;
  scope: BonusRuleScope;
  userId: string | null;
  rate: string | null;
  amount: string | null;
  threshold: string | null;
  cap: string | null;
  stage: PaymentStage | null;
  metric: KpiMetric | null;
  metricScope: BonusMetricScope;
  tierGroup: string | null;
  enabled: boolean;
  sortOrder: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BonusRuleSet {
  id: string;
  version: number;
  title: string;
  status: BonusRuleSetStatus;
  effectiveFrom: string;
  createdById: string | null;
  createdBy?: { id: string; fullName: string } | null;
  activatedAt: string | null;
  activatedById: string | null;
  activatedBy?: { id: string; fullName: string } | null;
  rules: BonusRule[];
  createdAt: string;
  updatedAt: string;
}

/** Построчная расшифровка бонуса — «правило → база → сумма», см. bonus-engine.ts BonusLine. */
export interface BonusLine {
  ruleId: string;
  kind: BonusRuleKind;
  label: string;
  base: string;
  amount: string;
  bucket: 'bonus' | 'kpi';
}

export interface PayslipUserRef {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

export interface PayslipActorRef {
  id: string;
  fullName: string;
}

export interface Payslip {
  id: string;
  userId: string;
  user: PayslipUserRef;
  periodStart: string;
  periodEnd: string;
  periodKey: string;
  revision: number;
  activeSlot: string | null;
  status: PayslipStatus;
  baseAmount: string;
  baseOverride: string | null;
  bonusAmount: string;
  kpiBonusAmount: string;
  adjustmentAmount: string;
  adjustmentReason: string | null;
  totalAmount: string;
  currency: string;
  ruleSetId: string | null;
  ruleSetVersion: number | null;
  formulaSnapshot: unknown;
  metricsSnapshot: unknown;
  breakdown: BonusLine[];
  leadsProcessed: number;
  consultationsHeld: number;
  contractsSigned: number;
  enrolledCount: number;
  relocatedCount: number;
  /** Доли 0..1 либо null — «нет базы», НЕ ноль (см. риск 11 проекта архитектора). */
  conversionRate: string | null;
  timelinessRate: string | null;
  deliveryRate: string | null;
  needsReview: boolean;
  calculatedAt: string | null;
  calculatedById: string | null;
  calculatedBy: PayslipActorRef | null;
  approvedAt: string | null;
  approvedById: string | null;
  approvedBy: PayslipActorRef | null;
  paidAt: string | null;
  paidById: string | null;
  paidBy: PayslipActorRef | null;
  paidReference: string | null;
  voidedAt: string | null;
  voidedById: string | null;
  voidedBy: PayslipActorRef | null;
  voidReason: string | null;
  replacedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Прогресс к порогу премии (KPI_THRESHOLD_BONUS, metricScope=PERSONAL) — GET /payroll/me/kpi. */
export interface PayrollProgressItem {
  ruleId: string;
  label: string;
  metric: KpiMetric;
  value: string | null;
  threshold: string;
  reached: boolean;
  remaining: string | null;
  reward: string | null;
}

/**
 * Командный показатель — ОДНО число по всему отделу, БЕЗ разбивки по людям,
 * и только если правило с этой метрикой реально влияет на премию сотрудника
 * (см. accessModel проекта архитектора, k-анонимность). null — нет такого
 * правила либо в отделе меньше 5 человек (сервер прячет число сам).
 */
export interface PayrollTeamMetric {
  metric: KpiMetric;
  value: string;
  threshold: string;
}

export interface PayrollMyKpi {
  period: string;
  /** «Метрика ведётся с ДД.ММ.ГГГГ» — раздел 5 выкатывается без бэкфилла истории. */
  metricsSince: string;
  leadsProcessed: number;
  consultationsHeld: number;
  contractsSigned: number;
  enrolledCount: number;
  relocatedCount: number;
  conversionRate: string | null;
  timelinessRate: string | null;
  deliveryRate: string | null;
  progress: PayrollProgressItem[];
  team: PayrollTeamMetric | null;
}

/** GET /payroll/me/preview — предварительный расчёт, НИЧЕГО не пишет в БД, всегда preliminary=true. */
export interface PayrollPreview {
  period: string;
  preliminary: true;
  metricsSince: string;
  baseAmount: string;
  bonusAmount: string;
  kpiBonusAmount: string;
  totalAmount: string;
  needsReview: boolean;
  breakdown: BonusLine[];
  ruleSetVersion: number | null;
}

export interface PayrollMyRuleView {
  id: string;
  kind: BonusRuleKind;
  label: string;
  scope: BonusRuleScope;
  /** Уже отформатировано на бэкенде под кабинет сотрудника: "3.00%" (не доля!). */
  rate: string | null;
  amount: string | null;
  threshold: string | null;
  cap: string | null;
  stage: PaymentStage | null;
  metric: KpiMetric | null;
  metricScope: BonusMetricScope;
  tierGroup: string | null;
}

export interface PayrollMyRules {
  ruleSetVersion: number | null;
  rules: PayrollMyRuleView[];
}

export interface MyCompensation {
  baseSalary: string | null;
  currency: string;
}

export interface PayrollAdminKpiItem {
  userId: string;
  fullName?: string;
  role?: Role;
  leadsProcessed: number;
  consultationsHeld: number;
  contractsSigned: number;
  contractsAmount: string;
  enrolledCount: number;
  relocatedCount: number;
  lostCount: number;
  conversionRate: string | null;
  timelinessRate: string | null;
  deliveryRate: string | null;
}

export interface PayrollAdminKpi {
  period: string;
  metricsSince: string;
  items: PayrollAdminKpiItem[];
}

export interface PayrollSummary {
  period: string;
  metricsSince: string;
  items: Payslip[];
  fundApproved: string;
  fundPaid: string;
}

export interface BonusRuleSimulateItem {
  userId: string;
  fullName: string;
  before: string;
  after: string;
  diff: string;
}

export interface BonusRuleSimulateResult {
  period: string;
  ruleSetVersion: number;
  items: BonusRuleSimulateItem[];
}
