import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BonusRuleKind, BonusRuleScope, BonusRuleSetStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { notDeleted } from '../common/soft-delete';
import { parseCalendarDate, formatDateRuShort } from '../grants/grant-year';
import { CreateBonusRuleDto, CreateBonusRuleSetDto, UpdateBonusRuleDto, UpdateBonusRuleSetDto } from './dto/bonus-rule.dto';
import { BonusRuleConfig } from './bonus-engine';

export type CurrentUser = { id: string; role: Role };

const RULE_INCLUDE = {
  rules: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.BonusRuleSetInclude;

/** Набор правил вместе со своими строками — тип для bonus-engine/payslips.service. */
export type RuleSetWithRules = Prisma.BonusRuleSetGetPayload<{ include: typeof RULE_INCLUDE }>;

function decimalOrNull(raw: string | null | undefined): Prisma.Decimal | null {
  if (raw === undefined || raw === null) return null;
  return new Prisma.Decimal(raw);
}

function money(v: Prisma.Decimal | null): string | null {
  return v ? v.toFixed(v.decimalPlaces() > 2 ? 4 : 2) : null;
}

/**
 * Раздел 5 ТЗ (волна 6) — версионирование формул бонусов. ACTIVE-набор
 * НЕЛЬЗЯ править ни одним эндпоинтом («изменение формул» = клон в DRAFT →
 * правки → активация НОВОЙ версии, см. formulaConfig проекта архитектора).
 * Активация — необратимый шаг, поэтому доступна только FOUNDER (проверяется
 * @Roles в контроллере); создание/редактирование ЧЕРНОВИКА доступно и ADMIN.
 */
@Injectable()
export class RulesService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  private serializeRule(rule: any) {
    return {
      ...rule,
      rate: money(rule.rate),
      amount: money(rule.amount),
      threshold: money(rule.threshold),
      cap: money(rule.cap),
    };
  }

  private serializeSet(set: any) {
    return { ...set, rules: (set.rules ?? []).map((r: any) => this.serializeRule(r)) };
  }

  async listSets(status?: BonusRuleSetStatus) {
    const rows = await this.prisma.bonusRuleSet.findMany({
      where: { deletedAt: null, ...(status ? { status } : {}) },
      orderBy: { version: 'desc' },
      include: RULE_INCLUDE,
    });
    return rows.map((r) => this.serializeSet(r));
  }

  async getSet(id: string) {
    const row = await this.prisma.bonusRuleSet.findFirst({ where: { id, deletedAt: null }, include: RULE_INCLUDE });
    if (!row) throw new NotFoundException('Набор правил не найден');
    return this.serializeSet(row);
  }

  /** Набор правил, ДЕЙСТВУЮЩИЙ на дату начала периода — последняя ACTIVE с effectiveFrom <= periodStart. */
  async activeSetFor(periodStart: Date) {
    return this.prisma.bonusRuleSet.findFirst({
      where: { deletedAt: null, status: BonusRuleSetStatus.ACTIVE, effectiveFrom: { lte: periodStart } },
      orderBy: { effectiveFrom: 'desc' },
      include: RULE_INCLUDE,
    });
  }

  /** Правила, применимые к конкретному сотруднику (scope=ALL + его личные scope=USER). */
  rulesForUser(ruleSet: { rules: any[] }, userId: string): BonusRuleConfig[] {
    return ruleSet.rules
      .filter((r) => r.enabled && (r.scope === BonusRuleScope.ALL || r.userId === userId))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        scope: r.scope,
        userId: r.userId,
        rate: r.rate,
        amount: r.amount,
        threshold: r.threshold,
        cap: r.cap,
        stage: r.stage,
        metric: r.metric,
        metricScope: r.metricScope,
        tierGroup: r.tierGroup,
        enabled: r.enabled,
        sortOrder: r.sortOrder,
      }));
  }

  async createSet(dto: CreateBonusRuleSetDto, actor: CurrentUser) {
    let effectiveFrom: Date;
    try {
      effectiveFrom = parseCalendarDate(dto.effectiveFrom);
    } catch {
      throw new BadRequestException('Некорректная дата начала действия набора');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const last = await tx.bonusRuleSet.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      const set = await tx.bonusRuleSet.create({
        data: { version, title: dto.title.trim(), effectiveFrom, status: BonusRuleSetStatus.DRAFT, createdById: actor.id },
      });

      if (dto.cloneFromId) {
        const source = await tx.bonusRuleSet.findFirst({
          where: { id: dto.cloneFromId, deletedAt: null },
          include: { rules: { where: { deletedAt: null } } },
        });
        if (!source) throw new NotFoundException('Набор для клонирования не найден');
        if (source.rules.length) {
          await tx.bonusRule.createMany({
            data: source.rules.map((r) => ({
              ruleSetId: set.id,
              kind: r.kind,
              label: r.label,
              scope: r.scope,
              userId: r.userId,
              rate: r.rate,
              amount: r.amount,
              threshold: r.threshold,
              cap: r.cap,
              stage: r.stage,
              metric: r.metric,
              metricScope: r.metricScope,
              tierGroup: r.tierGroup,
              enabled: r.enabled,
              sortOrder: r.sortOrder,
              note: r.note,
            })),
          });
        }
      }

      return set;
    });

    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RULESET_CREATE',
        details: `Создан черновик набора формул v${result.version} «${result.title}», действует с ${formatDateRuShort(effectiveFrom)}`,
      })
      .catch(() => undefined);

    return this.getSet(result.id);
  }

  private async loadDraftSet(id: string) {
    const set = await this.prisma.bonusRuleSet.findFirst({ where: { id, deletedAt: null } });
    if (!set) throw new NotFoundException('Набор правил не найден');
    if (set.status !== BonusRuleSetStatus.DRAFT) {
      throw new ConflictException('Редактировать можно только черновик набора правил');
    }
    return set;
  }

  async updateSet(id: string, dto: UpdateBonusRuleSetDto, actor: CurrentUser) {
    const set = await this.loadDraftSet(id);
    const data: Prisma.BonusRuleSetUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.effectiveFrom !== undefined) {
      try {
        data.effectiveFrom = parseCalendarDate(dto.effectiveFrom);
      } catch {
        throw new BadRequestException('Некорректная дата начала действия набора');
      }
    }
    await this.prisma.bonusRuleSet.update({ where: { id }, data });
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RULESET_CREATE',
        details: `Изменён черновик набора формул v${set.version}`,
      })
      .catch(() => undefined);
    return this.getSet(id);
  }

  /** FOUNDER — необратимый шаг (проверяется @Roles в контроллере). */
  async activate(id: string, actor: CurrentUser) {
    const set = await this.prisma.bonusRuleSet.findFirst({ where: { id, deletedAt: null } });
    if (!set) throw new NotFoundException('Набор правил не найден');
    if (set.status !== BonusRuleSetStatus.DRAFT) {
      throw new ConflictException('Активировать можно только черновик');
    }
    const now = new Date();
    const result = await this.prisma.bonusRuleSet.updateMany({
      where: { id, status: BonusRuleSetStatus.DRAFT, deletedAt: null },
      data: { status: BonusRuleSetStatus.ACTIVE, activatedAt: now, activatedById: actor.id },
    });
    if (result.count === 0) throw new ConflictException('Статус набора изменился, обновите страницу');

    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RULESET_ACTIVATE',
        details: `Активирован набор формул v${set.version} «${set.title}», действует с ${formatDateRuShort(set.effectiveFrom)}`,
      })
      .catch(() => undefined);
    return this.getSet(id);
  }

  async archive(id: string, actor: CurrentUser) {
    const set = await this.prisma.bonusRuleSet.findFirst({ where: { id, deletedAt: null } });
    if (!set) throw new NotFoundException('Набор правил не найден');
    if (set.status === BonusRuleSetStatus.ARCHIVED) {
      throw new ConflictException('Набор уже архивирован');
    }
    await this.prisma.bonusRuleSet.update({ where: { id }, data: { status: BonusRuleSetStatus.ARCHIVED } });
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RULESET_ARCHIVE',
        details: `Набор формул v${set.version} «${set.title}» отправлен в архив`,
      })
      .catch(() => undefined);
    return this.getSet(id);
  }

  /**
   * Обязательные числовые параметры по типу правила (formulaConfig проекта
   * архитектора) — единственная точка входа для валидации, вызывается и
   * из create, и из update (после мёржа с существующими значениями).
   */
  private validateFields(kind: BonusRuleKind, f: {
    rate: Prisma.Decimal | null;
    amount: Prisma.Decimal | null;
    threshold: Prisma.Decimal | null;
    cap: Prisma.Decimal | null;
    stage: string | null;
    metric: string | null;
  }): void {
    switch (kind) {
      case 'PERCENT_OF_CONTRACTS':
      case 'PERCENT_OF_PAYMENTS':
        if (!f.rate) throw new BadRequestException('Для процентного правила обязателен rate');
        if (!f.cap) throw new BadRequestException('Для процентного правила обязателен потолок (cap) — предохранитель от опечатки');
        break;
      // Потолок обязателен у ВСЕХ счётных правил, а не только у процентных.
      // Раньше эти четыре его не требовали, а bonus-engine трактует
      // отсутствие cap как «без ограничения». В связке с тем, что менеджер
      // сам готовит договоры, ошибка в одной цифре (ставка 5000 вместо 500)
      // или всплеск количества давали неограниченное начисление, которое
      // всплыло бы только на выплате.
      case 'FIXED_PER_CONTRACT':
      case 'FIXED_PER_ENROLLMENT':
      case 'FIXED_PER_RELOCATION':
        if (!f.amount) throw new BadRequestException('Для фиксированного правила обязателен amount');
        if (!f.cap) throw new BadRequestException('Для фиксированного правила обязателен потолок (cap) — предохранитель от опечатки');
        break;
      case 'FIXED_PER_STAGE':
        if (!f.amount) throw new BadRequestException('Для правила «за этап» обязателен amount');
        if (!f.stage) throw new BadRequestException('Для правила «за этап» обязателен stage');
        if (!f.cap) throw new BadRequestException('Для правила «за этап» обязателен потолок (cap) — предохранитель от опечатки');
        break;
      case 'FIXED_PER_CONSULTATION':
        if (!f.amount) throw new BadRequestException('Для правила «за консультацию» обязателен amount');
        if (!f.cap) throw new BadRequestException('Для правила «за консультацию» обязателен потолок (cap)');
        break;
      case 'KPI_THRESHOLD_BONUS':
        if (!f.metric) throw new BadRequestException('Для премии за KPI обязательна metric');
        if (!f.threshold) throw new BadRequestException('Для премии за KPI обязателен threshold');
        if (!f.amount && !f.rate) throw new BadRequestException('Для премии за KPI укажите amount либо rate');
        if (f.amount && f.rate) throw new BadRequestException('Для премии за KPI укажите ТОЛЬКО ОДНО из amount/rate');
        break;
    }
  }

  async addRule(setId: string, dto: CreateBonusRuleDto, actor: CurrentUser) {
    await this.loadDraftSet(setId);

    const scope = dto.scope ?? BonusRuleScope.ALL;
    if (scope === BonusRuleScope.USER) {
      if (!dto.userId) throw new BadRequestException('Для персонального правила обязателен userId');
      const user = await this.prisma.user.findFirst({
        where: { id: dto.userId, deletedAt: null, role: { in: [Role.EMPLOYEE, Role.ADMIN] } },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Сотрудник не найден');
    }

    const rate = decimalOrNull(dto.rate);
    const amount = decimalOrNull(dto.amount);
    const threshold = decimalOrNull(dto.threshold);
    const cap = decimalOrNull(dto.cap);
    this.validateFields(dto.kind, { rate, amount, threshold, cap, stage: dto.stage ?? null, metric: dto.metric ?? null });

    const rule = await this.prisma.bonusRule.create({
      data: {
        ruleSetId: setId,
        kind: dto.kind,
        label: dto.label.trim(),
        scope,
        userId: scope === BonusRuleScope.USER ? dto.userId : null,
        rate,
        amount,
        threshold,
        cap,
        stage: dto.stage,
        metric: dto.metric,
        metricScope: dto.metricScope,
        tierGroup: dto.tierGroup?.trim() || null,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
        note: dto.note?.trim() || null,
      },
    });

    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RULESET_CREATE',
        details: `Добавлено правило «${rule.label}» (${rule.kind}) в черновик набора`,
      })
      .catch(() => undefined);

    return this.serializeRule(rule);
  }

  async updateRule(ruleId: string, dto: UpdateBonusRuleDto, actor: CurrentUser) {
    const rule = await this.prisma.bonusRule.findFirst({ where: { id: ruleId, deletedAt: null } });
    if (!rule) throw new NotFoundException('Правило не найдено');
    await this.loadDraftSet(rule.ruleSetId);

    const nextKind = dto.kind ?? rule.kind;
    const nextScope = dto.scope ?? rule.scope;
    const nextRate = dto.rate !== undefined ? decimalOrNull(dto.rate) : rule.rate;
    const nextAmount = dto.amount !== undefined ? decimalOrNull(dto.amount) : rule.amount;
    const nextThreshold = dto.threshold !== undefined ? decimalOrNull(dto.threshold) : rule.threshold;
    const nextCap = dto.cap !== undefined ? decimalOrNull(dto.cap) : rule.cap;
    const nextStage = dto.stage !== undefined ? dto.stage : rule.stage;
    const nextMetric = dto.metric !== undefined ? dto.metric : rule.metric;
    let nextUserId = dto.userId !== undefined ? dto.userId : rule.userId;

    if (nextScope === BonusRuleScope.USER) {
      if (!nextUserId) throw new BadRequestException('Для персонального правила обязателен userId');
      const user = await this.prisma.user.findFirst({
        where: { id: nextUserId, deletedAt: null, role: { in: [Role.EMPLOYEE, Role.ADMIN] } },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Сотрудник не найден');
    } else {
      nextUserId = null;
    }

    this.validateFields(nextKind, { rate: nextRate, amount: nextAmount, threshold: nextThreshold, cap: nextCap, stage: nextStage, metric: nextMetric });

    const updated = await this.prisma.bonusRule.update({
      where: { id: ruleId },
      data: {
        kind: nextKind,
        label: dto.label !== undefined ? dto.label.trim() : undefined,
        scope: nextScope,
        userId: nextUserId,
        rate: nextRate,
        amount: nextAmount,
        threshold: nextThreshold,
        cap: nextCap,
        stage: nextStage,
        metric: nextMetric,
        metricScope: dto.metricScope ?? undefined,
        tierGroup: dto.tierGroup !== undefined ? dto.tierGroup?.trim() || null : undefined,
        enabled: dto.enabled ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        note: dto.note !== undefined ? dto.note?.trim() || null : undefined,
      },
    });

    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RULESET_CREATE',
        details: `Изменено правило «${updated.label}» в черновике набора`,
      })
      .catch(() => undefined);

    return this.serializeRule(updated);
  }

  async removeRule(ruleId: string, actor: CurrentUser) {
    const rule = await this.prisma.bonusRule.findFirst({ where: { id: ruleId, deletedAt: null } });
    if (!rule) throw new NotFoundException('Правило не найдено');
    await this.loadDraftSet(rule.ruleSetId);
    await this.prisma.bonusRule.update({ where: { id: ruleId }, data: { deletedAt: new Date() } });
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'PAYROLL_RULESET_CREATE',
        details: `Удалено правило «${rule.label}» из черновика набора`,
      })
      .catch(() => undefined);
    return { ok: true };
  }
}
