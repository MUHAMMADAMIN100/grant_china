import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentKind, PaymentPurpose, PaymentStage, PaymentStatus } from '@prisma/client';

/**
 * Порядок этапов в UI и отчётах. НЕ порядок объявления enum PaymentStage —
 * Postgres хранит enum в порядке объявления типа, и переставить его потом
 * означает DROP TYPE/CREATE TYPE (см. migrationSafety проекта архитектора).
 * Этот объект — единственный источник истины для Payment.stageOrder и
 * PaymentSchedule.stageOrder, сервис проставляет значение отсюда при записи.
 */
export const STAGE_ORDER: Record<PaymentStage, number> = {
  INITIAL: 1,
  REGISTRATION: 2,
  DOCUMENTATION: 3,
  ENROLLMENT: 4,
  RELOCATION: 5,
  LIVING_EXPENSES: 6,
};

/**
 * Этапы 1–3 (INITIAL/REGISTRATION/DOCUMENTATION/ENROLLMENT/RELOCATION) —
 * разовые платежи агентству по договору, попадают в блок «График платежей».
 * LIVING_EXPENSES — регулярные расходы студента уже в Китае, блок «Расходы
 * на месте». Инвариант stage↔kind держит сервис, DTO поле kind не принимает
 * (клиент не может подделать kind, не поменяв stage).
 */
export const STAGE_KIND: Record<PaymentStage, PaymentKind> = {
  INITIAL: 'SCHEDULE',
  REGISTRATION: 'SCHEDULE',
  DOCUMENTATION: 'SCHEDULE',
  ENROLLMENT: 'SCHEDULE',
  RELOCATION: 'SCHEDULE',
  LIVING_EXPENSES: 'ON_SITE',
};

/** Этапы графика (без LIVING_EXPENSES) — у расходов на месте плана нет. Порядок совпадает с STAGE_ORDER. */
export const SCHEDULE_STAGES: PaymentStage[] = [
  'INITIAL',
  'REGISTRATION',
  'DOCUMENTATION',
  'ENROLLMENT',
  'RELOCATION',
];

/** Подписи этапов для ActivityLog/логов — фронт использует свои (волна 3). */
export const STAGE_LABEL: Record<PaymentStage, string> = {
  INITIAL: 'Этап 1. Первичная оплата',
  REGISTRATION: 'Этап 1.1. Регистрация студента',
  DOCUMENTATION: 'Этап 2. Документация (виза, приглашение)',
  ENROLLMENT: 'Этап 2.1. После зачисления',
  RELOCATION: 'Этап 3. После переезда в Китай',
  LIVING_EXPENSES: 'Этап 4. Расходы на месте',
};

export const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  REGISTRATION: 'Регистрация студента',
  DOCUMENTATION: 'Документация',
  ENROLLMENT: 'Зачисление в университет',
  RELOCATION: 'После переезда',
  ACCOMMODATION: 'Проживание',
  FOOD: 'Питание',
  CONSULTATION: 'Консультация',
  OTHER: 'Другое',
};

/**
 * purpose ↔ stage: назначения «Проживание»/«Питание» имеют смысл только для
 * расходов на месте (LIVING_EXPENSES), а «Регистрация»/«Документация»/
 * «Зачисление»/«После переезда» — только для платежей по графику (ТЗ 1.2/1.3
 * описывают их как соответствующие этапы). «Консультация» и «Другое» не
 * привязаны к конкретному этапу и разрешены в обоих блоках.
 */
const ON_SITE_PURPOSES = new Set<PaymentPurpose>(['ACCOMMODATION', 'FOOD', 'CONSULTATION', 'OTHER']);
const SCHEDULE_PURPOSES = new Set<PaymentPurpose>([
  'REGISTRATION',
  'DOCUMENTATION',
  'ENROLLMENT',
  'RELOCATION',
  'CONSULTATION',
  'OTHER',
]);

export function isPurposeAllowedForStage(stage: PaymentStage, purpose: PaymentPurpose): boolean {
  return STAGE_KIND[stage] === 'ON_SITE' ? ON_SITE_PURPOSES.has(purpose) : SCHEDULE_PURPOSES.has(purpose);
}

/**
 * ТЗ 1.3: для «Проживания» и «Питания» отсутствие чека СТРОГО блокирует
 * сохранение — проверяется уже на создании (не только на подаче).
 */
export const RECEIPT_REQUIRED_ON_CREATE_PURPOSES = new Set<PaymentPurpose>(['ACCOMMODATION', 'FOOD']);

/** Статусы, из которых платёж ещё можно редактировать/удалять/менять чеки. */
export const EDITABLE_STATUSES = new Set<PaymentStatus>(['DRAFT', 'REJECTED']);

/** Максимум для Decimal(12,2) в схеме — 10 знаков до точки, 2 после. */
export const MAX_PAYMENT_AMOUNT = '9999999999.99';

/**
 * Единый предикат «это документ-чек» (Проблемы 1/2 аудита волны 1). Чек
 * должен управляться ИСКЛЮЧИТЕЛЬНО через payments/ (create/addReceipt/
 * removeReceipt соблюдают EDITABLE_STATUSES и RECEIPT_REQUIRED_ON_CREATE_PURPOSES).
 * Общие эндпоинты удаления документов (students/, student-auth/) обязаны
 * вызывать эту функцию и отказывать в удалении — иначе через них можно
 * снести доказательство оплаты в обход гейтов финансового модуля.
 * Проверяем и type==='RECEIPT', и paymentId (на случай будущей рассинхронизации
 * этих двух полей) — совпадение любого из них достаточно, чтобы считать
 * документ чеком.
 */
export function isReceiptDocument(doc: { type: string; paymentId?: string | null }): boolean {
  return doc.type === 'RECEIPT' || Boolean(doc.paymentId);
}

/** Бросает понятную ошибку, если документ — чек платежа (используется в students/, student-auth/). */
export function assertNotReceiptDocument(doc: { type: string; paymentId?: string | null }): void {
  if (isReceiptDocument(doc)) {
    throw new ForbiddenException('Чек платежа удаляется только через раздел Финансы');
  }
}

/**
 * Инвариант ТЗ 1.3: если итоговое назначение платежа требует чек
 * (RECEIPT_REQUIRED_ON_CREATE_PURPOSES — «Проживание»/«Питание»), у платежа
 * обязан остаться хотя бы один живой (не удалённый) чек. Раньше проверка
 * жила только в create() (Проблемы 3/4 аудита волны 1) — PATCH мог сменить
 * purpose на «Проживание» без чека, а removeReceipt() мог снести
 * единственный чек уже сохранённого такого платежа. Теперь одна функция,
 * вызывается из create/update/removeReceipt с уже посчитанным флагом
 * «остался ли живой чек после операции» — сама функция в БД не ходит.
 */
export function assertReceiptInvariant(purpose: PaymentPurpose, hasLiveReceiptAfterChange: boolean): void {
  if (!RECEIPT_REQUIRED_ON_CREATE_PURPOSES.has(purpose)) return;
  if (hasLiveReceiptAfterChange) return;
  throw new BadRequestException(`Для назначения «${PURPOSE_LABEL[purpose]}» обязателен хотя бы один чек`);
}
