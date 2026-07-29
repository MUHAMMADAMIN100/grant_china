export type Role = 'FOUNDER' | 'ADMIN' | 'EMPLOYEE';

export const ROLE_LABEL: Record<Role, string> = {
  FOUNDER: 'Основатель',
  ADMIN: 'Администратор',
  EMPLOYEE: 'Сотрудник',
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
  createdAt?: string;
}

export interface ManagerInfo {
  id: string;
  fullName: string;
  email: string;
}

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
  createdAt: string;
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

export type PaymentPurpose =
  | 'REGISTRATION'
  | 'DOCUMENTATION'
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
  REGISTRATION: 'Регистрация студента',
  DOCUMENTATION: 'Документация',
  ENROLLMENT: 'Зачисление в университет',
  RELOCATION: 'После переезда',
  ACCOMMODATION: 'Проживание',
  FOOD: 'Питание',
  CONSULTATION: 'Консультация',
  OTHER: 'Другое',
};

/** Назначения, допустимые для расходов на месте (kind=ON_SITE) — зеркало backend payment-rules.ts. */
export const ON_SITE_PAYMENT_PURPOSES: PaymentPurpose[] = ['ACCOMMODATION', 'FOOD', 'CONSULTATION', 'OTHER'];
/** Назначения, допустимые для платежей по графику (kind=SCHEDULE). */
export const SCHEDULE_PAYMENT_PURPOSES: PaymentPurpose[] = [
  'REGISTRATION',
  'DOCUMENTATION',
  'ENROLLMENT',
  'RELOCATION',
  'CONSULTATION',
  'OTHER',
];

/** Разумное значение по умолчанию для назначения при выборе этапа в форме — пользователь может изменить. */
export const DEFAULT_PAYMENT_PURPOSE: Record<PaymentStage, PaymentPurpose> = {
  INITIAL: 'OTHER',
  REGISTRATION: 'REGISTRATION',
  DOCUMENTATION: 'DOCUMENTATION',
  ENROLLMENT: 'ENROLLMENT',
  RELOCATION: 'RELOCATION',
  LIVING_EXPENSES: 'ACCOMMODATION',
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
