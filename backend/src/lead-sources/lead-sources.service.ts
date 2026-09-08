import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import {
  CUSTOM_SOURCE_PREFIX,
  LEAD_SOURCES,
  LEAD_SOURCE_LABEL,
  isCustomSourceCode,
  leadSourceLabelKey,
} from '../common/lead-source';

export interface LeadSourceItem {
  code: string;
  label: string;
  builtin: boolean;
  hidden: boolean;
  createdByName: string | null;
  createdAt: string | null;
  /** Сколько заявок / консультаций сейчас с этим источником (живых, без soft-delete). */
  applications: number;
  consultations: number;
}

interface Actor {
  sub: string;
  role: string;
  fullName?: string;
}

/**
 * 08.09.2026 — справочник источников привлечения, дополняемый сотрудниками.
 *
 * Раньше список был зашит в код (common/lead-source.ts), и всё, что в него
 * не влезало, сотрудники писали в «Другое» + текст-уточнение. В фильтре
 * «Все источники» такие заявки сливались в одну строку, и отчёт по каналам
 * терял именно те каналы, которых в списке не было (ярмарки вузов,
 * партнёрские школы, конкретные блогеры).
 *
 * Теперь пункт «Другое» открывает окно с названием, название сохраняется
 * сюда и получает код CUSTOM_<8 hex>. Код — как встроенные значения —
 * лежит в Application.source / Consultation.source, поэтому:
 *  - переименование меняет только подпись, заявки не трогаются;
 *  - скрытие (hiddenAt) убирает пункт из выбора, но старые заявки
 *    по-прежнему показывают и фильтруют его;
 *  - дубли по названию не создаются: второй «Ярмарка вузов» вернёт первый.
 */
@Injectable()
export class LeadSourcesService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  async list(): Promise<LeadSourceItem[]> {
    const [custom, apps, cons] = await Promise.all([
      this.prisma.leadSourceOption.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.application.groupBy({ by: ['source'], where: { deletedAt: null, source: { not: null } }, _count: { _all: true } }),
      this.prisma.consultation.groupBy({ by: ['source'], where: { deletedAt: null, source: { not: null } }, _count: { _all: true } }),
    ]);
    const appCount = new Map(apps.map((a) => [a.source as string, a._count._all]));
    const conCount = new Map(cons.map((c) => [c.source as string, c._count._all]));
    const builtin: LeadSourceItem[] = LEAD_SOURCES.map((s) => ({
      code: s.value,
      label: s.label,
      builtin: true,
      hidden: false,
      createdByName: null,
      createdAt: null,
      applications: appCount.get(s.value) ?? 0,
      consultations: conCount.get(s.value) ?? 0,
    }));
    const own: LeadSourceItem[] = custom.map((c) => ({
      code: c.code,
      label: c.label,
      builtin: false,
      hidden: !!c.hiddenAt,
      createdByName: c.createdByName,
      createdAt: c.createdAt.toISOString(),
      applications: appCount.get(c.code) ?? 0,
      consultations: conCount.get(c.code) ?? 0,
    }));
    return [...builtin, ...own];
  }

  /**
   * Создать или вернуть существующий. Сравнение по нормализованному
   * названию — и со своими, и со встроенными («сайт» → WEBSITE, а не новый
   * дубль). Скрытый источник с тем же названием возвращается к жизни: раз
   * сотрудник снова его вводит, он нужен.
   */
  async createOrGet(rawLabel: string, actor: Actor): Promise<{ item: LeadSourceItem; created: boolean }> {
    const label = (rawLabel ?? '').trim().replace(/\s+/g, ' ');
    if (label.length < 2) throw new BadRequestException('Название источника — минимум 2 символа');
    if (label.length > 60) throw new BadRequestException('Название источника — не длиннее 60 символов');
    const key = leadSourceLabelKey(label);

    const builtin = LEAD_SOURCES.find((s) => leadSourceLabelKey(s.label) === key || s.value === label.toUpperCase());
    if (builtin) return { item: await this.one(builtin.value), created: false };

    const existing = await this.prisma.leadSourceOption.findUnique({ where: { labelKey: key } });
    if (existing) {
      if (existing.hiddenAt) {
        await this.prisma.leadSourceOption.update({ where: { id: existing.id }, data: { hiddenAt: null } });
        this.log(actor, 'LEAD_SOURCE_UPDATE', `Источник «${existing.label}» снова показывается в списке (введён заново)`, { code: existing.code });
      }
      return { item: await this.one(existing.code), created: false };
    }

    let code = '';
    for (let i = 0; i < 5; i++) {
      code = CUSTOM_SOURCE_PREFIX + randomBytes(4).toString('hex');
      if (!(await this.prisma.leadSourceOption.findUnique({ where: { code } }))) break;
    }
    const actorName = actor.fullName ?? (await this.prisma.user.findUnique({ where: { id: actor.sub }, select: { fullName: true } }))?.fullName ?? null;
    const row = await this.prisma.leadSourceOption.create({ data: { code, label, labelKey: key, createdById: actor.sub, createdByName: actorName } });
    this.log(actor, 'LEAD_SOURCE_CREATE', `Добавлен источник привлечения «${label}»`, { code: row.code });
    return { item: await this.one(row.code), created: true };
  }

  async update(code: string, patch: { label?: string; hidden?: boolean }, actor: Actor): Promise<LeadSourceItem> {
    if (!isCustomSourceCode(code)) throw new BadRequestException('Встроенные источники менять нельзя');
    const row = await this.prisma.leadSourceOption.findUnique({ where: { code } });
    if (!row) throw new NotFoundException('Источник не найден');
    const data: { label?: string; labelKey?: string; hiddenAt?: Date | null } = {};
    const changes: string[] = [];
    if (patch.label !== undefined) {
      const label = patch.label.trim().replace(/\s+/g, ' ');
      if (label.length < 2 || label.length > 60) throw new BadRequestException('Название источника — от 2 до 60 символов');
      const key = leadSourceLabelKey(label);
      if (LEAD_SOURCES.some((s) => leadSourceLabelKey(s.label) === key)) throw new BadRequestException('Такой встроенный источник уже есть');
      const dup = await this.prisma.leadSourceOption.findUnique({ where: { labelKey: key } });
      if (dup && dup.id !== row.id) throw new BadRequestException(`Источник «${dup.label}» уже есть`);
      if (label !== row.label) { data.label = label; data.labelKey = key; changes.push(`название «${row.label}» → «${label}»`); }
    }
    if (patch.hidden !== undefined) {
      const hide = !!patch.hidden;
      if (hide !== !!row.hiddenAt) { data.hiddenAt = hide ? new Date() : null; changes.push(hide ? 'скрыт из выбора' : 'снова показывается'); }
    }
    if (Object.keys(data).length) {
      await this.prisma.leadSourceOption.update({ where: { id: row.id }, data });
      this.log(actor, 'LEAD_SOURCE_UPDATE', `Источник «${data.label ?? row.label}»: ${changes.join(', ')}`, { code });
    }
    return this.one(code);
  }

  /**
   * Код можно записать в заявку: встроенный, либо свой и существующий.
   * Скрытый — тоже можно (старую заявку с ним пересохраняют), нельзя только
   * выдуманный: он показывался бы в CRM голым кодом.
   */
  async assertUsable(code: string | null | undefined): Promise<void> {
    if (!code || !isCustomSourceCode(code)) return;
    const row = await this.prisma.leadSourceOption.findUnique({ where: { code }, select: { id: true } });
    if (!row) throw new BadRequestException('Неизвестный источник привлечения');
  }

  /** Подпись для писем/журнала: встроенная, своя или сам код, если ничего не нашлось. */
  async labelOf(code: string | null | undefined): Promise<string> {
    if (!code) return 'не указан';
    if (LEAD_SOURCE_LABEL[code]) return LEAD_SOURCE_LABEL[code];
    const row = await this.prisma.leadSourceOption.findUnique({ where: { code }, select: { label: true } });
    return row?.label ?? code;
  }

  private async one(code: string): Promise<LeadSourceItem> {
    const item = (await this.list()).find((i) => i.code === code);
    if (!item) throw new NotFoundException('Источник не найден');
    return item;
  }

  private log(actor: Actor, action: 'LEAD_SOURCE_CREATE' | 'LEAD_SOURCE_UPDATE', details: string, payload: Record<string, unknown>) {
    this.activity.log({ actorId: actor.sub, actorRole: actor.role, action, details, payload }).catch(() => undefined);
  }
}
