import { Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, Prisma, Region, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { APP_TZ_OFFSET_MINUTES } from '../scheduler/time';
import { assignedFieldsForRegion, assignedToUserFilter } from '../common/access';
import { isFounder, isPrivileged } from '../common/roles';
import { LEAD_SOURCES } from '../common/lead-source';
import { CHANNEL_LABEL } from '../messaging/channels';
import { configFor } from '../messaging/meta/meta.config';
import { ApplicationsService, FUNNEL_COLUMNS, FUNNEL_STATUSES } from '../applications/applications.service';

/**
 * 09.11.2026 — Аналитика → «Продажи» (по образцу, который прислал владелец, в
 * дизайне GrantChina). Руководство видит всё и может выбрать сотрудника;
 * менеджер — только свои цифры, параметр «сотрудник» для него игнорируется.
 *
 * Определения — те же, что в остальной CRM, чтобы цифры не расходились:
 *  - Лиды — заявки, созданные за период (как вкладки «Заявки»). «Свои» —
 *    по той же формуле назначения, что в списке заявок (регион TJ/CN).
 *  - Закрытые сделки — заявки, переведённые в «Зачислены» за период
 *    (Application.enrolledAt). У сотрудника — кто зачислил (enrolledById),
 *    как в KPI «Моей зарплаты».
 *  - Конверсия — из заявок периода сколько уже зачислено, %. Когортная, а не
 *    «зачислено в периоде / заявок в периоде»: после импорта старых заявок
 *    такая дробь давала 1233% за август 2026 (111 зачислений на 9 новых
 *    заявок). Когортная никогда не больше 100% и отвечает на вопрос «какая
 *    доля заявок этого месяца дошла до зачисления».
 *  - Выручка — все платежи за период: одобренные + ждущие одобрения
 *    (решение владельца 09.11.2026: договоры в CRM пока не ведутся, суммы в
 *    графиках платежей не заполнены — деньги видны только платежами).
 *  - Получено — одобренные платежи за период (как «Итого поступлений» в
 *    «Финансах»).
 *  - Ожидается — на сегодня: платежи, ждущие одобрения, + остаток по
 *    графикам платежей (как «Остаток по плану» в «Финансах»).
 *  Деньги сотрудника — платежи его студентов (назначение по региону, та же
 *  формула, что в списках студентов).
 *  - Скорость ответа — от обращения клиента (первое входящее после нашего
 *    ответа) до первого ответа сотрудника в том же чате.
 *
 * Деньги по конкретному сотруднику видит Основатель и сам сотрудник —
 * Администратору поимённые суммы закрыты так же, как срез byManager в
 * «Финансах» (кадровая оценка — раздел Основателя).
 */

export type SalesPeriodKey = 'today' | 'week' | 'month' | 'year';
export const SALES_PERIODS: readonly SalesPeriodKey[] = ['today', 'week', 'month', 'year'];

interface Viewer {
  id: string;
  role: Role;
  region?: Region | null;
}
interface Person {
  id: string;
  fullName: string;
  role: Role;
  region: Region | null;
}
type Scope = { kind: 'all' } | { kind: 'person'; person: Person; self: boolean };

const OFFSET_MS = APP_TZ_OFFSET_MINUTES * 60_000;
const LOCAL_SHIFT = Prisma.raw(`interval '${APP_TZ_OFFSET_MINUTES} minutes'`);
/** Порядок этапов для «прогресса по воронке»: старые статусы — на своих местах. */
const STAGE_INDEX: Record<ApplicationStatus, number> = {
  NEW: 0,
  DOCS_REVIEW: 1,
  IN_PROGRESS: 1,
  DOCS_SUBMITTED: 2,
  PRE_ADMISSION: 3,
  AWAITING_PAYMENT: 4,
  ENROLLED: 5,
  COMPLETED: 5,
} as Record<ApplicationStatus, number>;
const PROGRESS_STAGES = FUNNEL_COLUMNS.filter((k) => k !== 'ARCHIVED');

/** Заявка дошла до зачисления (старые записи без enrolledAt — по статусу). */
const ENROLLED_WHERE: Prisma.ApplicationWhereInput = { OR: [{ enrolledAt: { not: null } }, { status: { in: ['ENROLLED', 'COMPLETED'] } }] };
const ENROLLED_SQL = Prisma.sql`("enrolledAt" IS NOT NULL OR "status"::text IN ('ENROLLED', 'COMPLETED'))`;

const money = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);

/** Начало суток по Душанбе для локальной даты (месяц/день могут «перелезать» — Date.UTC их нормализует). */
const localDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - OFFSET_MS);

/**
 * Период «с начала дня / недели (с понедельника) / месяца / года» по Душанбе и
 * такой же отрезок прошлого периода: 1–9 ноября сравниваются с 1–9 октября,
 * а не с целым октябрём — иначе начало месяца всегда выглядело бы провалом.
 */
export function salesPeriod(key: SalesPeriodKey, now = new Date()) {
  const l = new Date(now.getTime() + OFFSET_MS);
  const y = l.getUTCFullYear();
  const m = l.getUTCMonth();
  const d = l.getUTCDate();
  let from: Date;
  let prevFrom: Date;
  if (key === 'today') {
    from = localDate(y, m, d);
    prevFrom = localDate(y, m, d - 1);
  } else if (key === 'week') {
    const back = (l.getUTCDay() + 6) % 7;
    from = localDate(y, m, d - back);
    prevFrom = localDate(y, m, d - back - 7);
  } else if (key === 'year') {
    from = localDate(y, 0, 1);
    prevFrom = localDate(y - 1, 0, 1);
  } else {
    from = localDate(y, m, 1);
    prevFrom = localDate(y, m - 1, 1);
  }
  const elapsed = now.getTime() - from.getTime();
  const prevTo = new Date(Math.min(prevFrom.getTime() + elapsed, from.getTime()));
  return { key, from, to: now, prevFrom, prevTo };
}

interface Range {
  from: Date;
  to: Date;
}

@Injectable()
export class SalesAnalyticsService {
  constructor(
    private prisma: PrismaService,
    private applications: ApplicationsService,
  ) {}

  async summary(viewer: Viewer, periodKey: SalesPeriodKey, employeeId?: string) {
    const scope = await this.scopeFor(viewer, employeeId);
    const period = salesPeriod(periodKey);
    const cur: Range = { from: period.from, to: period.to };
    const prev: Range = { from: period.prevFrom, to: period.prevTo };
    // Деньги по конкретному человеку — Основателю и самому человеку.
    const money_ = scope.kind === 'all' ? true : isFounder(viewer.role) || scope.self;
    const managerMoney = isFounder(viewer.role) || (scope.kind === 'person' && scope.self);

    const [kpiCur, kpiPrev, monthly, sources, managers, chats, stages, progress, revenue] = await Promise.all([
      this.kpi(scope, cur),
      this.kpi(scope, prev),
      this.monthly(scope),
      this.sources(scope, cur),
      this.managers(scope, cur, managerMoney),
      this.chats(scope, cur),
      this.stages(scope),
      this.progress(scope, cur),
      money_ ? this.revenueBlock(scope, cur) : Promise.resolve(null),
    ]);

    return {
      period: { key: periodKey, from: period.from.toISOString(), to: period.to.toISOString(), prevFrom: period.prevFrom.toISOString(), prevTo: period.prevTo.toISOString() },
      scope:
        scope.kind === 'all'
          ? { kind: 'all' as const, money: money_ }
          : { kind: scope.self ? ('self' as const) : ('employee' as const), id: scope.person.id, name: scope.person.fullName, money: money_ },
      kpi: {
        leads: { value: kpiCur.leads, prev: kpiPrev.leads },
        deals: { value: kpiCur.deals, prev: kpiPrev.deals },
        conversion: { value: rate(kpiCur.converted, kpiCur.leads), prev: rate(kpiPrev.converted, kpiPrev.leads), converted: kpiCur.converted, leads: kpiCur.leads },
        revenue: money_ ? { value: money(kpiCur.revenue), prev: money(kpiPrev.revenue) } : null,
      },
      monthly,
      sources,
      managers: { money: managerMoney, items: managers },
      response: chats.response,
      channels: chats.channels,
      stages,
      progress,
      revenue,
    };
  }

  /** Кого считаем: всех, выбранного сотрудника (руководство) или самого себя (менеджер). */
  private async scopeFor(viewer: Viewer, employeeId?: string): Promise<Scope> {
    if (!isPrivileged(viewer.role)) {
      const me = await this.prisma.user.findUnique({ where: { id: viewer.id }, select: { id: true, fullName: true, role: true, region: true } });
      if (!me) throw new NotFoundException('Сотрудник не найден');
      return { kind: 'person', person: me, self: true };
    }
    if (!employeeId) return { kind: 'all' };
    const person = await this.prisma.user.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true, fullName: true, role: true, region: true } });
    if (!person) throw new NotFoundException('Сотрудник не найден');
    return { kind: 'person', person, self: person.id === viewer.id };
  }

  /** Заявки «этого человека» — та же формула, что в списке заявок. */
  private leadScope(scope: Scope): Prisma.ApplicationWhereInput {
    if (scope.kind === 'all') return {};
    return { OR: assignedToUserFilter({ id: scope.person.id, role: scope.person.role, region: scope.person.region }) as Prisma.ApplicationWhereInput[] };
  }

  private leadScopeSql(scope: Scope): Prisma.Sql {
    if (scope.kind === 'all') return Prisma.empty;
    const fields = assignedFieldsForRegion(scope.person.region);
    return Prisma.sql`AND (${Prisma.join(fields.map((f) => Prisma.sql`${Prisma.raw(`"${f}"`)} = ${scope.person.id}`), ' OR ')})`;
  }

  /** Студенты «этого человека» (живые) — для денег. */
  private studentScope(scope: Scope): Prisma.StudentWhereInput {
    if (scope.kind === 'all') return { deletedAt: null };
    return { deletedAt: null, OR: assignedToUserFilter({ id: scope.person.id, role: scope.person.role, region: scope.person.region }) as Prisma.StudentWhereInput[] };
  }

  private studentScopeSql(scope: Scope): Prisma.Sql {
    if (scope.kind === 'all') return Prisma.empty;
    const fields = assignedFieldsForRegion(scope.person.region);
    return Prisma.sql`AND (${Prisma.join(fields.map((f) => Prisma.sql`s.${Prisma.raw(`"${f}"`)} = ${scope.person.id}`), ' OR ')})`;
  }

  /** Платежи за период: одобренные и (для выручки) ждущие одобрения. */
  private payments(scope: Scope, r: Range, statuses: Array<'APPROVED' | 'PENDING_APPROVAL'>): Prisma.PaymentWhereInput {
    return { deletedAt: null, status: { in: statuses }, paidAt: { gte: r.from, lt: r.to }, student: this.studentScope(scope) };
  }

  private async kpi(scope: Scope, r: Range) {
    const leadsWhere: Prisma.ApplicationWhereInput = { deletedAt: null, createdAt: { gte: r.from, lt: r.to }, ...this.leadScope(scope) };
    const [leads, converted, deals, revenue] = await Promise.all([
      this.prisma.application.count({ where: leadsWhere }),
      this.prisma.application.count({ where: { AND: [leadsWhere, ENROLLED_WHERE] } }),
      this.prisma.application.count({
        where: { deletedAt: null, enrolledAt: { gte: r.from, lt: r.to }, ...(scope.kind === 'person' ? { enrolledById: scope.person.id } : {}) },
      }),
      this.prisma.payment.aggregate({ where: this.payments(scope, r, ['APPROVED', 'PENDING_APPROVAL']), _sum: { amount: true } }),
    ]);
    return { leads, converted, deals, revenue: revenue._sum.amount ?? new Prisma.Decimal(0) };
  }

  /** Последние 12 месяцев (по Душанбе): заявки месяца и сколько из них уже зачислено. */
  private async monthly(scope: Scope) {
    const now = new Date();
    const l = new Date(now.getTime() + OFFSET_MS);
    const start = localDate(l.getUTCFullYear(), l.getUTCMonth() - 11, 1);
    const rows = await this.prisma.$queryRaw<Array<{ m: string; n: number; e: number }>>`
      SELECT to_char(date_trunc('month', "createdAt" + ${LOCAL_SHIFT}), 'YYYY-MM') AS m,
             COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE ${ENROLLED_SQL})::int AS e
      FROM "Application"
      WHERE "deletedAt" IS NULL AND "createdAt" >= ${start} ${this.leadScopeSql(scope)}
      GROUP BY 1`;
    const byMonth = new Map(rows.map((x) => [x.m, x]));
    const out: Array<{ month: string; leads: number; converted: number; conversion: number | null }> = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() - 11 + i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const x = byMonth.get(key);
      const leads = Number(x?.n ?? 0);
      const converted = Number(x?.e ?? 0);
      out.push({ month: key, leads, converted, conversion: rate(converted, leads) });
    }
    return out;
  }

  /** Источники лидов за период. Свои источники — по их названиям, пустой — «Не указан». */
  private async sources(scope: Scope, r: Range) {
    const rows = await this.prisma.application.groupBy({
      by: ['source'],
      where: { deletedAt: null, createdAt: { gte: r.from, lt: r.to }, ...this.leadScope(scope) },
      _count: { _all: true },
    });
    const custom = rows.map((x) => x.source).filter((c): c is string => !!c && !LEAD_SOURCES.some((s) => s.value === c));
    const customLabels = custom.length
      ? new Map((await this.prisma.leadSourceOption.findMany({ where: { code: { in: custom } }, select: { code: true, label: true } })).map((c) => [c.code, c.label]))
      : new Map<string, string>();
    return rows
      .map((x) => ({
        code: x.source ?? 'NONE',
        label: !x.source ? 'Не указан' : (LEAD_SOURCES.find((s) => s.value === x.source)?.label ?? customLabels.get(x.source) ?? x.source),
        count: x._count._all,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Менеджеры: сделки и выручка за период. Менеджеру — только его строка.
   * Выручка человека — платежи его студентов по формуле региона (TJ —
   * managerId, CN — chinaManagerId, без региона — оба): та же цифра, что он
   * видит у себя. Сумма по строкам может быть больше общей выручки — у
   * студента бывают и таджикский, и китайский менеджер, оба видят его оплату.
   */
  private async managers(scope: Scope, r: Range, withMoney: boolean) {
    const only = scope.kind === 'person' ? scope.person.id : undefined;
    const staff = await this.prisma.user.findMany({
      where: only ? { id: only } : { deletedAt: null, role: 'EMPLOYEE' },
      select: { id: true, fullName: true },
    });
    const [dealRows, revenueRows] = await Promise.all([
      this.prisma.application.groupBy({
        by: ['enrolledById'],
        where: { deletedAt: null, enrolledAt: { gte: r.from, lt: r.to }, enrolledById: only ?? { not: null } },
        _count: { _all: true },
      }),
      staff.length
        ? this.prisma.$queryRaw<Array<{ id: string; amount: Prisma.Decimal }>>`
            SELECT u."id", COALESCE(SUM(p."amount"), 0) AS amount
            FROM "User" u
            JOIN "Student" s ON s."deletedAt" IS NULL AND (
                 (s."managerId" = u."id" AND (u."region" IS NULL OR u."region"::text <> 'CN'))
              OR (s."chinaManagerId" = u."id" AND (u."region" IS NULL OR u."region"::text <> 'TJ')))
            JOIN "Payment" p ON p."studentId" = s."id" AND p."deletedAt" IS NULL
                 AND p."status"::text IN ('APPROVED', 'PENDING_APPROVAL') AND p."paidAt" >= ${r.from} AND p."paidAt" < ${r.to}
            WHERE u."id" IN (${Prisma.join(staff.map((x) => x.id))})
            GROUP BY u."id"`
        : Promise.resolve([] as Array<{ id: string; amount: Prisma.Decimal }>),
    ]);
    const byId = new Map<string, { id: string; name: string; deals: number; revenue: Prisma.Decimal }>();
    const row = (id: string) => {
      let x = byId.get(id);
      if (!x) {
        x = { id, name: '', deals: 0, revenue: new Prisma.Decimal(0) };
        byId.set(id, x);
      }
      return x;
    };
    for (const u of staff) row(u.id).name = u.fullName;
    for (const d of dealRows) if (d.enrolledById) row(d.enrolledById).deals = d._count._all;
    for (const v of revenueRows) row(v.id).revenue = new Prisma.Decimal(v.amount ?? 0);
    // Сделки есть у бывшего сотрудника или у руководителя — имя дочитываем.
    const nameless = [...byId.values()].filter((x) => !x.name).map((x) => x.id);
    if (nameless.length) {
      for (const u of await this.prisma.user.findMany({ where: { id: { in: nameless } }, select: { id: true, fullName: true } })) row(u.id).name = u.fullName;
    }
    return [...byId.values()]
      .filter((x) => x.name)
      .sort((x, y) => y.deals - x.deals || y.revenue.comparedTo(x.revenue) || x.name.localeCompare(y.name, 'ru'))
      .map((x) => ({ id: x.id, name: x.name, deals: x.deals, revenue: withMoney ? money(x.revenue) : null }));
  }

  /**
   * Обращения клиентов в чатах и скорость первого ответа. Обращение — входящее,
   * перед которым в чате было НЕ входящее (наш ответ, авто-ответ) или ничего:
   * серия из пяти сообщений подряд — одно обращение, а не пять. Ответ — первое
   * исходящее от сотрудника (authorId задан) после обращения.
   * У сотрудника — чаты, которые он ведёт сейчас.
   * Неподключённые мессенджеры (WhatsApp у GrantChina) не показываем, как в «Диалогах».
   */
  private async chats(scope: Scope, r: Range) {
    const hidden = (['INSTAGRAM', 'WHATSAPP'] as const).filter((ch) => {
      const cfg = configFor(ch);
      return !cfg.enabled && cfg.missing.length === 0;
    });
    const hiddenSql = hidden.length ? Prisma.sql`AND c."channel" NOT IN (${Prisma.join(hidden)})` : Prisma.empty;
    const ownerSql = scope.kind === 'person' ? Prisma.sql`AND c."assignedToId" = ${scope.person.id}` : Prisma.empty;
    // Окно шире периода: чтобы понять, было ли сообщение началом обращения,
    // нужен предыдущий; ответ на обращение в конце периода может прийти позже.
    const windowFrom = new Date(r.from.getTime() - 30 * 86400_000);
    const windowTo = new Date(Math.min(r.to.getTime() + 7 * 86400_000, Date.now() + 60_000));
    const rows = await this.prisma.$queryRaw<
      Array<{ channel: string | null; asks: number; answered: number; fast: number; avg_s: number | null; median_s: number | null }>
    >`
      WITH msgs AS (
        SELECT m."conversationId" AS cid, c."channel" AS channel, m."sentAt" AS at, m."direction"::text AS dir, m."authorId" AS author,
               LAG(m."direction"::text) OVER (PARTITION BY m."conversationId" ORDER BY m."sentAt", m."id") AS prev_dir
        FROM "ChannelMessage" m
        JOIN "Conversation" c ON c."id" = m."conversationId" AND c."deletedAt" IS NULL ${hiddenSql} ${ownerSql}
        WHERE m."deletedAt" IS NULL AND m."sentAt" >= ${windowFrom} AND m."sentAt" < ${windowTo}
      ),
      asks AS (
        SELECT cid, channel, at FROM msgs
        WHERE dir = 'INBOUND' AND prev_dir IS DISTINCT FROM 'INBOUND' AND at >= ${r.from} AND at < ${r.to}
      ),
      timed AS (
        SELECT a.channel, EXTRACT(EPOCH FROM (
          SELECT MIN(o.at) FROM msgs o WHERE o.cid = a.cid AND o.dir = 'OUTBOUND' AND o.author IS NOT NULL AND o.at > a.at
        ) - a.at)::float8 AS secs
        FROM asks a
      )
      SELECT channel,
             COUNT(*)::int AS asks,
             COUNT(secs)::int AS answered,
             COUNT(*) FILTER (WHERE secs <= 900)::int AS fast,
             AVG(secs)::float8 AS avg_s,
             (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs))::float8 AS median_s
      FROM timed
      GROUP BY GROUPING SETS ((channel), ())`;
    const total = rows.find((x) => x.channel === null);
    const minutes = (s: number | null | undefined) => (s === null || s === undefined ? null : Math.round((Number(s) / 60) * 10) / 10);
    return {
      response: {
        asks: Number(total?.asks ?? 0),
        answered: Number(total?.answered ?? 0),
        within15: Number(total?.fast ?? 0),
        avgMinutes: minutes(total?.avg_s),
        medianMinutes: minutes(total?.median_s),
      },
      channels: rows
        .filter((x) => x.channel !== null)
        .map((x) => ({ channel: x.channel as string, label: CHANNEL_LABEL[x.channel as string] ?? (x.channel as string), asks: Number(x.asks), answered: Number(x.answered), medianMinutes: minutes(x.median_s) }))
        .sort((a, b) => b.asks - a.asks),
    };
  }

  /** Клиенты по этапам — сейчас, как колонки «Воронки» (с её названиями). */
  private async stages(scope: Scope) {
    const where = this.leadScope(scope);
    const labels = await this.applications.funnelLabels();
    const counts = await Promise.all(
      FUNNEL_COLUMNS.map((key) =>
        this.prisma.application.count({
          where:
            key === 'ARCHIVED'
              ? { deletedAt: null, archivedAt: { not: null }, ...where }
              : { deletedAt: null, archivedAt: null, status: { in: FUNNEL_STATUSES[key] }, ...where },
        }),
      ),
    );
    return FUNNEL_COLUMNS.map((key, i) => ({ key, label: labels[key], count: counts[i] }));
  }

  /** Из заявок периода — сколько дошли до каждого этапа (и сколько в отказе). */
  private async progress(scope: Scope, r: Range) {
    const where: Prisma.ApplicationWhereInput = { deletedAt: null, createdAt: { gte: r.from, lt: r.to }, ...this.leadScope(scope) };
    const [byStatus, refused] = await Promise.all([
      this.prisma.application.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.application.count({ where: { ...where, archivedAt: { not: null } } }),
    ]);
    const total = byStatus.reduce((s, x) => s + x._count._all, 0);
    const labels = await this.applications.funnelLabels();
    return {
      total,
      refused,
      stages: PROGRESS_STAGES.map((key, i) => {
        const reached = byStatus.filter((x) => (STAGE_INDEX[x.status] ?? 0) >= i).reduce((s, x) => s + x._count._all, 0);
        return { key, label: labels[key], reached, pct: total ? Math.round((reached / total) * 1000) / 10 : 0 };
      }),
    };
  }

  /** Выручка и получено — за период; ожидается — на сегодня (ждут одобрения + остаток по графикам). */
  private async revenueBlock(scope: Scope, r: Range) {
    const [revenue, received, pending, planned] = await Promise.all([
      this.prisma.payment.aggregate({ where: this.payments(scope, r, ['APPROVED', 'PENDING_APPROVAL']), _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: this.payments(scope, r, ['APPROVED']), _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.aggregate({
        where: { deletedAt: null, status: 'PENDING_APPROVAL', student: this.studentScope(scope) },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Та же формула, что «Остаток по плану» в «Финансах»: план этапа минус
      // одобренная оплата того же студента и этапа, не меньше нуля.
      this.prisma.$queryRaw<Array<{ amount: Prisma.Decimal | null }>>`
        WITH paid AS (
          SELECT "studentId", "stage", SUM("amount") AS total
          FROM "Payment"
          WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL
          GROUP BY "studentId", "stage"
        )
        SELECT COALESCE(SUM(GREATEST(ps."plannedAmount" - COALESCE(paid.total, 0), 0)), 0) AS amount
        FROM "PaymentSchedule" ps
        JOIN "Student" s ON s."id" = ps."studentId" AND s."deletedAt" IS NULL
        LEFT JOIN paid ON paid."studentId" = ps."studentId" AND paid."stage" = ps."stage"
        WHERE ps."deletedAt" IS NULL AND ps."plannedAmount" > 0 ${this.studentScopeSql(scope)}`,
    ]);
    const pendingAmount = new Prisma.Decimal(pending._sum.amount ?? 0);
    const plannedAmount = new Prisma.Decimal(planned[0]?.amount ?? 0);
    return {
      revenue: { amount: money(revenue._sum.amount), count: revenue._count._all },
      received: { amount: money(received._sum.amount), count: received._count._all },
      expected: {
        amount: money(pendingAmount.plus(plannedAmount)),
        pending: { amount: money(pendingAmount), count: pending._count._all },
        planned: money(plannedAmount),
      },
    };
  }
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}
