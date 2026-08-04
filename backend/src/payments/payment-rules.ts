import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentKind, PaymentMethod, PaymentPurpose, PaymentStage, PaymentStatus } from '@prisma/client';

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

/**
 * ТЗ v3 раздел 3. Первые пять — актуальный список выбора. Остальные значения
 * остаются в enum ради читаемости старых записей (см. комментарий к
 * PaymentPurpose в schema.prisma) и в новый платёж не попадают.
 *
 * Подписи старых значений НЕ переименованы намеренно: если в базе после
 * перевода истории что-то осталось со старым типом, в интерфейсе должно быть
 * видно РОВНО то, чем этот платёж был, а не подставленное новое название.
 */
export const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  // Пять пунктов ТЗ v3 — порядок совпадает с порядком в выпадающем списке.
  PREPAYMENT: 'Предоплата',
  UNIVERSITY_REGISTRATION: 'Оплата за регистрацию в университете',
  DOCUMENTATION: 'Документация',
  FULL_PAYMENT: 'Полная оплата',
  TUITION_ACCOMMODATION: 'Оплата за обучение и проживание',
  // Историческе значения — только для чтения старых записей.
  REGISTRATION: 'Регистрация студента',
  ENROLLMENT: 'Зачисление в университет',
  RELOCATION: 'После переезда',
  ACCOMMODATION: 'Проживание',
  FOOD: 'Питание',
  CONSULTATION: 'Консультация',
  OTHER: 'Другое',
};

/**
 * Ровно пять пунктов выпадающего списка из ТЗ v3 раздел 3, в порядке ТЗ.
 * Единственный источник истины: и валидация DTO, и фронтенд обязаны брать
 * список отсюда, иначе один из них однажды разрешит выбрать исторический тип.
 */
export const SELECTABLE_PURPOSES: PaymentPurpose[] = [
  'PREPAYMENT',
  'UNIVERSITY_REGISTRATION',
  'DOCUMENTATION',
  'FULL_PAYMENT',
  'TUITION_ACCOMMODATION',
];

const SELECTABLE_PURPOSE_SET = new Set<PaymentPurpose>(SELECTABLE_PURPOSES);

/** true, если этот тип можно выбрать для НОВОГО платежа (а не только прочитать в старом). */
export function isSelectablePurpose(purpose: PaymentPurpose): boolean {
  return SELECTABLE_PURPOSE_SET.has(purpose);
}

/**
 * ТЗ v3 раздел 3, строка 2 таблицы: «Оплата за регистрацию в университете —
 * право проведения ТОЛЬКО у Основателя (Администратор и Менеджеры только
 * видят)».
 *
 * Именно «проведения», а не «просмотра»: платежи этого типа менеджер видит в
 * карточке студента и в списке финансов, но создать или изменить такой платёж
 * не может. Множество, а не одно значение — чтобы при появлении второго
 * такого пункта не пришлось искать все места сравнения.
 */
export const FOUNDER_ONLY_PURPOSES = new Set<PaymentPurpose>(['UNIVERSITY_REGISTRATION']);

// Раздел 2.6 ТЗ (финансовая аналитика Основателя): подписи способа оплаты
// для разбивки «наличные / безнал» — нужна Основателю для сверки с кассой
// и банковской выпиской. Совпадает с frontend-crm/src/api/types.ts
// PAYMENT_METHOD_LABEL — единый справочник для бэкенда (аналитика/логи).
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Наличные',
  CASHLESS: 'Безналичный расчёт',
};

/**
 * purpose ↔ stage: платежи по графику и расходы на месте — разные блоки, и
 * назначение обязано соответствовать блоку.
 *
 * ТЗ v3 раздел 3: из пяти новых типов к расходам на месте относится только
 * «Оплата за обучение и проживание» — единственный, где вообще упомянуто
 * проживание в КНР. Остальные четыре — взносы агентству по графику.
 *
 * ИСТОРИЧЕСКИЕ ЗНАЧЕНИЯ ОСТАВЛЕНЫ В ОБОИХ МНОЖЕСТВАХ намеренно. Выбрать их
 * для нового платежа нельзя (это ловит assertPurposeSelectable), но старый
 * платёж с purpose='OTHER' обязан продолжать редактироваться: если убрать
 * OTHER отсюда, любая правка суммы у десяти существующих таких платежей
 * падала бы с «назначение не соответствует этапу», хотя пользователь
 * назначение вообще не трогал.
 */
const ON_SITE_PURPOSES = new Set<PaymentPurpose>([
  'TUITION_ACCOMMODATION',
  // историческе
  'ACCOMMODATION',
  'FOOD',
  'CONSULTATION',
  'OTHER',
]);
const SCHEDULE_PURPOSES = new Set<PaymentPurpose>([
  'PREPAYMENT',
  'UNIVERSITY_REGISTRATION',
  'DOCUMENTATION',
  'FULL_PAYMENT',
  'TUITION_ACCOMMODATION',
  // историческе
  'REGISTRATION',
  'ENROLLMENT',
  'RELOCATION',
  'CONSULTATION',
  'OTHER',
]);

export function isPurposeAllowedForStage(stage: PaymentStage, purpose: PaymentPurpose): boolean {
  return STAGE_KIND[stage] === 'ON_SITE' ? ON_SITE_PURPOSES.has(purpose) : SCHEDULE_PURPOSES.has(purpose);
}

/** Назначения, допустимые для выбора в конкретном блоке — для выпадающего списка. */
export function selectablePurposesForStage(stage: PaymentStage): PaymentPurpose[] {
  return SELECTABLE_PURPOSES.filter((p) => isPurposeAllowedForStage(stage, p));
}

/**
 * ТЗ v3 раздел 3 — в новый платёж может попасть только один из пяти пунктов.
 * Вызывается на создании и на смене назначения при правке; если поле purpose
 * не передали, старое историческое значение остаётся как есть.
 */
export function assertPurposeSelectable(purpose: PaymentPurpose): void {
  if (isSelectablePurpose(purpose)) return;
  throw new BadRequestException(
    `Тип оплаты «${PURPOSE_LABEL[purpose]}» больше не используется. Выберите один из действующих: ${SELECTABLE_PURPOSES.map((p) => PURPOSE_LABEL[p]).join(', ')}`,
  );
}

/**
 * ТЗ v3 раздел 3 — «Оплата за регистрацию в университете»: право проведения
 * только у Основателя. Проверка на уровне правил, а не контроллера: тип
 * платежа приходит в теле запроса, а @Roles умеет смотреть только на роль.
 */
export function assertPurposeAllowedForRole(purpose: PaymentPurpose, role: string): void {
  if (!FOUNDER_ONLY_PURPOSES.has(purpose)) return;
  if (role === 'FOUNDER') return;
  throw new ForbiddenException(
    `Платёж с типом «${PURPOSE_LABEL[purpose]}» может провести только Основатель`,
  );
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
