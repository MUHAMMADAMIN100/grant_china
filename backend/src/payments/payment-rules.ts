import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentKind, PaymentMethod, PaymentPurpose, PaymentStage, PaymentStatus, Prisma, Region } from '@prisma/client';

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
/**
 * ТЗ «Разделение воронок» — какому офису принадлежит этап.
 *
 * Заказчик обвёл на экране три карточки для Таджикистана и две для Китая:
 *   Таджикистан — Этап 1 (первичная оплата), Этап 2 (документация),
 *                 Этап 2.1 (после зачисления);
 *   Китай       — Этап 1.1 (регистрация студента), Этап 3 (после переезда),
 *                 а также блок «Расходы на месте» — это траты студента,
 *                 который уже в Китае.
 *
 * ПОЧЕМУ ПОРЯДОК ЭТАПОВ В ПОДПИСЯХ ОСТАЛСЯ ПРЕЖНИМ (1, 1.1, 2, 2.1, 3), хотя
 * по смыслу «регистрация студента» теперь идёт после «после зачисления»:
 * значения enum в БД переименовывать нельзя — это DROP TYPE и потеря истории
 * по 171 существующему платежу. Подписи и группировка на экране решают задачу,
 * а идентификаторы остаются прежними.
 *
 * Это ЕДИНСТВЕННЫЙ источник истины о принадлежности этапа. Любая проверка
 * доступа — и в списках, и в карточке, и при создании платежа — обязана
 * спрашивать здесь, а не сравнивать этапы вручную. Ручные копии условий уже
 * дважды приводили к дырам (регионы в списках, регионы в уведомлениях).
 */
export const STAGE_OFFICE: Record<PaymentStage, 'TJ' | 'CN'> = {
  INITIAL: 'TJ',
  DOCUMENTATION: 'TJ',
  ENROLLMENT: 'TJ',
  REGISTRATION: 'CN',
  RELOCATION: 'CN',
  LIVING_EXPENSES: 'CN',
};

/**
 * Этапы, доступные сотруднику. FOUNDER и ADMIN видят всё — по ТЗ они
 * наблюдают обе воронки целиком. Менеджер видит только этапы своего офиса;
 * регион BOTH означает «ведёт оба направления», такому доступны все этапы.
 *
 * Пустой список невозможен: любой регион даёт хотя бы один офис.
 */
export function stagesForUser(role: string, region: string | null | undefined): PaymentStage[] {
  const all = Object.keys(STAGE_OFFICE) as PaymentStage[];
  if (role === 'FOUNDER' || role === 'ADMIN') return all;
  if (region === 'TJ') return all.filter((s) => STAGE_OFFICE[s] === 'TJ');
  if (region === 'CN') return all.filter((s) => STAGE_OFFICE[s] === 'CN');
  return all;
}

/** true — сотруднику этот этап виден и доступен для работы. */
export function canSeeStage(stage: PaymentStage, role: string, region: string | null | undefined): boolean {
  return stagesForUser(role, region).includes(stage);
}

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
 * ТЗ v3 раздел 4, графа «Права по финансовой части» — какие типы оплат МЕНЕДЖЕР
 * данного региона может ПРОВЕСТИ (не «увидеть»: видит он всё по своим студентам).
 *
 * Дословно из таблицы ролей:
 *   Менеджер (Китай):
 *     • Предоплата
 *     • Оплата за регистрацию в университете (ТОЛЬКО ПРОСМОТР)
 *     • Оплата за обучение и проживание
 *   Менеджер (Таджикистан):
 *     «Просмотр и проведение платежей только по своим студентам
 *      (без доступа к общим цифрам)» — перечня типов НЕТ, значит ограничения
 *      по типам у него тоже нет.
 *
 * Отсюда два следствия, которые стоит проговорить:
 *
 * 1. UNIVERSITY_REGISTRATION не входит НИ В ОДИН региональный список — это и
 *    есть «право проведения только у Основателя» из раздела 3. Отдельного
 *    множества FOUNDER_ONLY больше нет: оно было вторым источником истины про
 *    то же самое, и при правке одного из двух они бы разъехались.
 *
 * 2. BOTH получает набор Таджикистана, а не пересечение с Китаем. Человек,
 *    ведущий оба направления, не должен оказаться ограниченнее того, кто ведёт
 *    только одно; ТЗ его случай не описывает, потому что в нём таких ролей нет.
 */
export const PURPOSES_BY_REGION: Record<Region, PaymentPurpose[]> = {
  CN: ['PREPAYMENT', 'TUITION_ACCOMMODATION'],
  // Решение владельца 12.08.2026: менеджерам Таджикистана открыты ВСЕ пять
  // типов, включая «Оплату за регистрацию в университете» — прежнее правило
  // «регистрацию проводит только Основатель» (ТЗ v3 раздел 3) снято для ТJ
  // и BOTH. Для Китая список из ТЗ оставлен как был.
  TJ: ['PREPAYMENT', 'UNIVERSITY_REGISTRATION', 'DOCUMENTATION', 'FULL_PAYMENT', 'TUITION_ACCOMMODATION'],
  BOTH: ['PREPAYMENT', 'UNIVERSITY_REGISTRATION', 'DOCUMENTATION', 'FULL_PAYMENT', 'TUITION_ACCOMMODATION'],
};

/**
 * Типы, которые конкретный сотрудник может провести.
 *
 * FOUNDER — все пять («полное управление» в его строке таблицы).
 * ADMIN — все пять (решение владельца 12.08.2026: Администратор вносит оплаты
 *   по любому студенту как менеджер; прежний read-only из ТЗ v3 снят —
 *   см. canWriteFinance в common/roles.ts). Одобрение ему по-прежнему закрыто.
 * EMPLOYEE — по региону.
 */
export function purposesForActor(role: string, region: Region | string | null | undefined): PaymentPurpose[] {
  if (role === 'FOUNDER' || role === 'ADMIN') return SELECTABLE_PURPOSES;
  if (role !== 'EMPLOYEE') return [];
  return PURPOSES_BY_REGION[(region as Region) ?? 'BOTH'] ?? PURPOSES_BY_REGION.BOTH;
}

// Раздел 2.6 ТЗ (финансовая аналитика Основателя): подписи способа оплаты
// для разбивки «наличные / безнал» — нужна Основателю для сверки с кассой
// и банковской выпиской. Совпадает с frontend-crm/src/api/types.ts
// PAYMENT_METHOD_LABEL — единый справочник для бэкенда (аналитика/логи).
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Наличные',
  CASHLESS: 'Безналичный расчёт',
  MIXED: 'Смешанная (нал + безнал)',
};

/**
 * Смешанная оплата (12.08.2026) — инвариант разбивки сумм.
 *
 * method = MIXED: обе части обязательны, каждая больше нуля, сумма частей
 * равна amount копейка в копейку. «Смешанная» с нулевой частью — это обычная
 * оплата одним способом, и оформлять её как смешанную значит портить
 * разбивку «касса/банк» в аналитике.
 *
 * Любой другой method: частей быть не должно. Пришли — это ошибка клиента
 * (например, сменили способ с MIXED, а разбивку прислали старую); молча
 * отбросить = потерять данные без предупреждения, поэтому 400.
 *
 * Возвращает то, что нужно записать в БД: у MIXED — обе части, у остальных
 * NULL в обеих колонках (в т.ч. затирание старой разбивки при смене способа).
 */
export function normalizeMethodParts(
  method: PaymentMethod,
  amount: Prisma.Decimal,
  cashAmount: string | null | undefined,
  cashlessAmount: string | null | undefined,
): { cashAmount: Prisma.Decimal | null; cashlessAmount: Prisma.Decimal | null } {
  if (method !== 'MIXED') {
    if (cashAmount != null || cashlessAmount != null) {
      throw new BadRequestException('Разбивка «наличные/безнал» указывается только при смешанной оплате');
    }
    return { cashAmount: null, cashlessAmount: null };
  }
  if (cashAmount == null || cashlessAmount == null) {
    throw new BadRequestException('Для смешанной оплаты укажите обе части: сколько наличными и сколько безналом');
  }
  const cash = new Prisma.Decimal(cashAmount);
  const cashless = new Prisma.Decimal(cashlessAmount);
  if (cash.lessThanOrEqualTo(0) || cashless.lessThanOrEqualTo(0)) {
    throw new BadRequestException(
      'Обе части смешанной оплаты должны быть больше нуля — иначе это обычная оплата одним способом',
    );
  }
  if (!cash.plus(cashless).equals(amount)) {
    throw new BadRequestException(
      `Части смешанной оплаты (${cash.toFixed(2)} + ${cashless.toFixed(2)} = ${cash.plus(cashless).toFixed(2)}) не сходятся с общей суммой ${amount.toFixed(2)}`,
    );
  }
  return { cashAmount: cash, cashlessAmount: cashless };
}

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
 * ТЗ v3 разделы 3 и 4 — может ли ЭТОТ сотрудник провести платёж ЭТОГО типа.
 *
 * Проверка на уровне правил, а не декоратором @Roles на контроллере: тип
 * платежа приходит в теле запроса, а @Roles умеет смотреть только на роль.
 * Регион — по той же причине: он тоже не выражается декоратором.
 *
 * ИСТОРИЧЕСКИЕ ТИПЫ НЕ ОГРАНИЧИВАЕМ. Их нет ни в одном региональном списке, и
 * формально они «не разрешены» никому — но выбрать их для нового платежа и так
 * нельзя (assertPurposeSelectable), а вот отредактировать сумму у уже
 * существующего платежа со старым типом менеджер должен мочь. Без этой ветки
 * десять платежей с типом «Другое» в боевой базе оказались бы заморожены
 * для своих же авторов.
 */
export function assertPurposeAllowedForActor(
  purpose: PaymentPurpose,
  role: string,
  region: Region | string | null | undefined,
): void {
  if (!isSelectablePurpose(purpose)) return;
  const allowed = purposesForActor(role, region);
  if (allowed.includes(purpose)) return;

  // Сообщение разное, потому что причины разные, и человеку надо понять,
  // идти ли ему к Основателю или он просто выбрал не тот пункт.
  const founderOnly = !PURPOSES_BY_REGION.TJ.includes(purpose) && !PURPOSES_BY_REGION.CN.includes(purpose);
  throw new ForbiddenException(
    founderOnly
      ? `Платёж с типом «${PURPOSE_LABEL[purpose]}» может провести только Основатель`
      : `Тип оплаты «${PURPOSE_LABEL[purpose]}» недоступен менеджеру этого региона. Доступны: ${allowed
          .map((p) => PURPOSE_LABEL[p])
          .join(', ')}`,
  );
}

/**
 * Double Check (ТЗ 1.1) — причастность к платежу закрывает право его одобрить.
 * Возвращает причину запрета или null, если одобрять можно.
 *
 * ИСКЛЮЧЕНИЕ ДЛЯ ОСНОВАТЕЛЯ (решение владельца, 12.08.2026).
 * Исходное правило запрещало одобрять платёж и автору записи, и подавшему её.
 * На практике это заперло систему: платежи заводит сам Основатель, одобрять их
 * по @Roles может только он же, а Администратор в финансах read-only — то есть
 * акцептовать было физически некому. 33 платежа на 431 287 сомони зависли в
 * очереди и не попадали в выручку. Владелец выбрал снять запрет с себя.
 *
 * ЧТО ЭТО ЗНАЧИТ ЧЕСТНО: сегодня одобрение закрыто @Roles(FOUNDER), поэтому
 * сюда доходит только Основатель — и правило перестаёт срабатывать вовсе.
 * Контроль над самостоятельно проведённым платежом держится теперь на
 * обязательном чеке и записи в ActivityLog, а не на разделении рук.
 *
 * ПОЧЕМУ ФУНКЦИЯ ВСЁ РАВНО ОСТАЁТСЯ, А НЕ УДАЛЕНА. Если одобрение однажды
 * откроют Администратору или старшему менеджеру (это обсуждалось как
 * альтернатива), запрет обязан ожить сам, без того чтобы кто-то вспомнил про
 * него и написал заново. Удалить проверку — значит заложить дыру в тот день,
 * когда изменится одна строка в контроллере.
 */
export function selfApprovalBlock(
  payment: { createdById?: string | null; submittedById?: string | null },
  user: { id: string; role: string | null | undefined },
): string | null {
  if (user.role === 'FOUNDER') return null;
  if (payment.createdById && payment.createdById === user.id) {
    return 'Нельзя одобрить платёж, который вы сами внесли в систему — одобряющий проверяет чужую работу.';
  }
  if (payment.submittedById && payment.submittedById === user.id) {
    return 'Нельзя одобрить платёж, который вы сами подали на одобрение — так работает двухстороннее подтверждение.';
  }
  return null;
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
