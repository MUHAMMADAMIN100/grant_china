import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { notDeleted } from '../common/soft-delete';
import { parseCalendarDate } from '../grants/grant-year';
import { SetCompensationDto } from './dto/compensation.dto';

export type CurrentUser = { id: string; role: Role };

/**
 * Раздел 5 ТЗ (волна 6) — оклад сотрудника. ТЗ 2.8: «Основатель имеет доступ
 * к кадровым ведомостям» — реестр ставок ЦЕЛИКОМ закрыт @Roles(FOUNDER) на
 * контроллере (см. accessModel проекта архитектора: ADMIN видит начисленное
 * в сводной ведомости, но не управляет реестром окладов).
 *
 * Отдельная таблица С ИСТОРИЕЙ, не поле в User — см. комментарий к модели
 * EmployeeCompensation в schema.prisma: (1) оклад меняется во времени,
 * (2) в проекте есть prisma.user.findFirst() без select, куда утёк бы оклад
 * при первой неосторожной отдаче объекта наружу, (3) отдельная граница
 * доступа и аудит.
 */
@Injectable()
export class CompensationService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  /** История ставок одного сотрудника, новые сверху. */
  async history(userId: string) {
    const rows = await this.prisma.employeeCompensation.findMany({
      where: { userId, deletedAt: null },
      orderBy: { effectiveFrom: 'desc' },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return rows.map((r) => ({ ...r, baseSalary: r.baseSalary.toFixed(2) }));
  }

  /**
   * Действующая ставка сотрудника НА ДАТУ (последняя запись с
   * effectiveFrom <= at). Используется генерацией расчётного листа и
   * /payroll/me/compensation (там — на текущий момент).
   */
  async effectiveAt(userId: string, at: Date): Promise<Prisma.Decimal | null> {
    const row = await this.prisma.employeeCompensation.findFirst({
      where: { userId, deletedAt: null, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
      select: { baseSalary: true },
    });
    return row?.baseSalary ?? null;
  }

  /** Текущие ставки ВСЕХ сотрудников (кроме FOUNDER — у него не зарплата, а прибыль) + фонд оплаты труда. */
  async current() {
    const users = await this.prisma.user.findMany({
      where: { ...notDeleted, role: { in: [Role.EMPLOYEE, Role.ADMIN] } },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true, role: true },
    });
    const now = new Date();
    const rows = await Promise.all(
      users.map(async (u) => ({
        ...u,
        baseSalary: await this.effectiveAt(u.id, now),
      })),
    );
    let fund = new Prisma.Decimal(0);
    for (const r of rows) if (r.baseSalary) fund = fund.plus(r.baseSalary);
    return {
      items: rows.map((r) => ({ ...r, baseSalary: r.baseSalary ? r.baseSalary.toFixed(2) : null })),
      fundTotal: fund.toFixed(2),
    };
  }

  async set(dto: SetCompensationDto, actor: CurrentUser) {
    // select — та же защита, что везде в проекте: findFirst без select тянет
    // ВСЕ скаляры User, включая password (bcrypt-хэш), в память процесса.
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, ...notDeleted }, select: { id: true, fullName: true } });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    let baseSalary: Prisma.Decimal;
    try {
      baseSalary = new Prisma.Decimal(dto.baseSalary);
    } catch {
      throw new BadRequestException('Некорректный оклад');
    }
    if (baseSalary.lessThanOrEqualTo(0)) throw new BadRequestException('Оклад должен быть положительным числом');

    let effectiveFrom: Date;
    try {
      effectiveFrom = parseCalendarDate(dto.effectiveFrom);
    } catch {
      throw new BadRequestException('Некорректная дата начала действия ставки');
    }

    const created = await this.prisma.employeeCompensation
      .create({
        data: {
          userId: dto.userId,
          baseSalary,
          effectiveFrom,
          note: dto.note?.trim() || null,
          createdById: actor.id,
        },
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('На эту дату у сотрудника уже есть ставка');
        }
        throw e;
      });

    // В details СУММЫ НЕТ. Весь CompensationController закрыт @Roles(FOUNDER)
    // именно затем, чтобы оклады не видел даже Администратор — а журнал
    // активности отдаётся любому привилегированному (activity.service.list).
    // Строка вида «Оклад Иванов И.И.: 5000.00 TJS» обходила бы эту границу
    // целиком: достаточно открыть /activity.
    // Факт изменения фиксируем (это кадровое событие, оно должно быть в
    // журнале), а саму цифру смотрят в реестре ставок, под нужной ролью.
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'COMPENSATION_SET',
        details: `Изменена ставка сотрудника ${user.fullName} с ${dto.effectiveFrom}`,
        payload: { userId: user.id },
      })
      .catch(() => undefined);

    return { ...created, baseSalary: created.baseSalary.toFixed(2) };
  }

  /**
   * Soft-delete ставки. 409, если на её период (от effectiveFrom до даты
   * следующей ставки, если она есть) уже опирается хотя бы один
   * APPROVED/PAID расчётный лист — исправление такого начисления идёт
   * через adjustment следующего периода, не через удаление истории окладов.
   */
  async remove(id: string, actor: CurrentUser) {
    const existing = await this.prisma.employeeCompensation.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Ставка не найдена');

    const next = await this.prisma.employeeCompensation.findFirst({
      where: { userId: existing.userId, deletedAt: null, effectiveFrom: { gt: existing.effectiveFrom } },
      orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true },
    });
    const referenced = await this.prisma.payslip.count({
      where: {
        userId: existing.userId,
        deletedAt: null,
        status: { in: ['APPROVED', 'PAID'] },
        periodStart: { gte: existing.effectiveFrom, ...(next ? { lt: next.effectiveFrom } : {}) },
      },
    });
    if (referenced > 0) {
      throw new ConflictException(
        'На эту ставку уже опираются утверждённые расчётные листы — исправление невозможно, заведите новую ставку с более поздней датой',
      );
    }

    await this.prisma.employeeCompensation.update({ where: { id }, data: { deletedAt: new Date() } });
    this.activity
      .log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'COMPENSATION_SET',
        details: `Ставка удалена из истории (id ${id})`,
        payload: { userId: existing.userId },
      })
      .catch(() => undefined);
    return { ok: true };
  }
}
