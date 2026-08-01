import { Injectable } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TasksService } from '../../tasks/tasks.service';
import { SmsService } from '../../sms/sms.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';
import { formatLocalDateTime, localDayStart, localHour } from '../time';

// РЕШЕНИЕ ЗАКАЗЧИКА (сверх ТЗ раздела «Билеты»): два независимых напоминания.
//  1) За 3 дня — АВТОЗАДАЧА ответственному менеджеру «проверить готовность».
//  2) За 1 сутки — SMS самому студенту с номером рейса и временем вылета.
// Пороги разные, потому что и адресаты разные: менеджеру нужно время успеть
// что-то исправить, студенту — напоминание накануне.
const TASK_LEAD_MS = 3 * 24 * 60 * 60 * 1000;
const SMS_LEAD_MS = 24 * 60 * 60 * 1000;

// Приложение могло лежать сутками — джоба обязана «догнать» пропущенные
// вылеты. Но включение фичи спустя месяцы не должно выстрелить лавиной SMS
// из глубокой истории, поэтому верхняя граница давности. Тот же приём и та же
// причина, что в follow-up-reminder.job.ts.
const MAX_CATCHUP_MS = 7 * 24 * 60 * 60 * 1000;

// Уже улетевшим напоминать бессмысленно: SMS «завтра ваш рейс» человеку,
// который вчера приземлился в Пекине, хуже, чем отсутствие SMS.
const SMS_MIN_LEAD_MS = 0;

const BATCH_SIZE = 200;

// «Тихие часы» по Душанбе — не будим студента SMS в 3 часа ночи и не создаём
// менеджеру задачу посреди ночи. Тот же приём, что в остальных джобах.
const QUIET_HOUR_START = 8;
const QUIET_HOUR_END = 21;

/**
 * Раздел «Билеты» (волна 8) — напоминания о ближайших вылетах.
 *
 * ИДЕМПОТЕНТНОСТЬ — паттерн B (claim-flag, job.contract.ts): строка сначала
 * атомарно ЗАНИМАЕТСЯ условным UPDATE (`where: { id, taskCreatedAt: null }`
 * → count === 1 значит «моя»), и только потом создаётся задача / уходит SMS.
 * Два инстанса Railway и повторный тик не могут отправить дубль.
 * ВТОРОЙ, независимый слой защиты — Task.originKey @unique.
 *
 * ПЕРЕНОС РЕЙСА: tickets.service.update() сбрасывает оба флага в null при
 * любом изменении departureAt — новый срок вылета порождает новый цикл
 * напоминаний (без этого перенос молча убивал бы напоминание навсегда).
 * Одного сброса флага мало: в originKey задачи входит САМ МОМЕНТ ВЫЛЕТА,
 * иначе повторный проход упёрся бы в занятый ключ и вернул старую задачу.
 *
 * ОТМЕНЁННЫЕ билеты (status = CANCELLED) исключены В ЗАПРОСЕ, а не после
 * выборки: отбракованный после take: BATCH_SIZE кандидат не помечается
 * claim'ом и потому возвращался бы в выборку на КАЖДОМ прогоне, вытесняя
 * реальных кандидатов (та же ошибка, что была разобрана в
 * academic-year-reminder.job.ts).
 */
@Injectable()
export class FlightReminderJob implements ScheduledJob {
  readonly name = 'flight-reminder';
  readonly everyMinutes = 60;

  constructor(
    private prisma: PrismaService,
    private tasks: TasksService,
    private sms: SmsService,
    private notifications: NotificationsService,
  ) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const hour = localHour(ctx.now);
    if (hour < QUIET_HOUR_START || hour >= QUIET_HOUR_END) {
      return { created: 0, skipped: 0, hasMore: false };
    }

    const task = await this.runTaskReminders(ctx);
    const sms = await this.runSmsReminders(ctx);

    ctx.logger.log(
      `[${this.name}] задачи менеджерам: ${task.created} (пропущено ${task.skipped}), ` +
        `SMS студентам: ${sms.created} (пропущено ${sms.skipped})`,
    );

    return {
      created: task.created + sms.created,
      skipped: task.skipped + sms.skipped,
      hasMore: task.hasMore || sms.hasMore,
    };
  }

  // ------------------------------------------------------------------
  // 1) Задача менеджеру за 3 дня до вылета
  // ------------------------------------------------------------------

  private async runTaskReminders(ctx: JobContext): Promise<JobResult> {
    const upperBound = new Date(ctx.now.getTime() + TASK_LEAD_MS);
    const lowerBound = new Date(ctx.now.getTime() - MAX_CATCHUP_MS);

    const candidates = await this.prisma.ticket.findMany({
      where: {
        deletedAt: null,
        taskCreatedAt: null,
        status: { not: TicketStatus.CANCELLED },
        departureAt: { gte: lowerBound, lte: upperBound },
        // Отчисленный/архивный студент никуда не летит.
        student: { is: { deletedAt: null, status: { in: ['ACTIVE', 'PAUSED'] } } },
      },
      orderBy: { departureAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        destinationCity: true,
        departureAt: true,
        flightNumber: true,
        airline: true,
        status: true,
        createdById: true,
        student: { select: { id: true, fullName: true, phones: true, managerId: true, chinaManagerId: true } },
      },
    });

    let created = 0;
    let skipped = 0;
    let usedFounderFallback = false;
    let cachedFounderId: string | null | undefined;

    for (const t of candidates) {
      // Исполнитель обязан быть ЖИВЫМ сотрудником: увольнение (soft-delete) не
      // обнуляет managerId у студентов, а createSystemTask на удалённого
      // исполнителя бросает NotFoundException — claim откатился бы, и ошибка
      // повторялась бы каждый час до бесконечности (разобрано в
      // academic-year-reminder.job.ts).
      const maybe = [t.student.managerId, t.student.chinaManagerId, t.createdById].filter(
        (v): v is string => !!v,
      );
      const aliveIds = new Set<string>();
      if (maybe.length) {
        const alive = await this.prisma.user.findMany({
          where: { id: { in: maybe }, deletedAt: null },
          select: { id: true },
        });
        alive.forEach((u) => aliveIds.add(u.id));
      }
      const pick = (id: string | null | undefined): string | null => (id && aliveIds.has(id) ? id : null);

      let assigneeId = pick(t.student.managerId) ?? pick(t.student.chinaManagerId);
      let usedFallback = false;
      if (!assigneeId) {
        usedFallback = true;
        assigneeId = pick(t.createdById);
      }
      if (!assigneeId) {
        if (cachedFounderId === undefined) {
          const founder = await this.prisma.user.findFirst({
            where: { role: Role.FOUNDER, deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          cachedFounderId = founder?.id ?? null;
        }
        assigneeId = cachedFounderId;
      }
      if (!assigneeId) {
        skipped += 1;
        continue;
      }

      const claimed = await this.prisma.ticket.updateMany({
        where: { id: t.id, taskCreatedAt: null },
        data: { taskCreatedAt: ctx.now },
      });
      if (claimed.count !== 1) {
        skipped += 1; // кто-то другой уже занял
        continue;
      }

      const departure = formatLocalDateTime(t.departureAt, true);
      const lines = [
        `Проверить готовность студента ${t.student.fullName} к вылету.`,
        `Рейс: ${t.flightNumber}${t.airline ? ` (${t.airline})` : ''} → ${t.destinationCity}`,
        `Вылет: ${departure} (время душанбинское)`,
      ];
      if (t.student.phones.length) lines.push(`Телефон: ${t.student.phones.join(', ')}`);
      if (t.status === TicketStatus.BOOKED) {
        lines.push('ВНИМАНИЕ: билет всё ещё в статусе «Забронирован» — проверьте, выкуплен ли он.');
      }
      if (usedFallback) {
        lines.push('У студента не назначен ответственный менеджер — назначьте его в карточке.');
      }

      try {
        await this.tasks.createSystemTask({
          title: `Вылет через 3 дня: ${t.student.fullName}`,
          description: lines.join('\n'),
          assignedToId: assigneeId,
          // Срок задачи — сам день вылета, но не в прошлом.
          dueDate: new Date(Math.max(t.departureAt.getTime(), ctx.now.getTime() + 60 * 60 * 1000)),
          // Ключ включает id БИЛЕТА: у студента бывает несколько перелётов
          // (стыковка, обратный, перелёт на второй год), и ключ по одному
          // студенту склеил бы их в одну задачу — второй INSERT молча упал бы
          // на unique, и о втором рейсе менеджер не узнал бы вовсе.
          //
          // И МОМЕНТ ВЫЛЕТА — иначе перенос рейса не порождает напоминания.
          // tickets.service.update() сбрасывает taskCreatedAt, джоба берёт
          // билет заново, но createSystemTask по УЖЕ ЗАНЯТОМУ ключу ловит
          // P2002 и возвращает старую (возможно уже закрытую) задачу со
          // старой датой — не создавая ничего и никого не уведомляя.
          // Новый срок вылета = новый ключ = честно новая задача. Внутри
          // одного цикла ключ стабилен (дата не меняется), поэтому
          // идемпотентность повторного тика и второго инстанса сохраняется.
          originKey: `flight:${t.id}:${t.departureAt.getTime()}`,
        });
        created += 1;
        if (usedFallback) usedFounderFallback = true;
      } catch (e) {
        // Откатываем claim СРАВНЕНИЕМ С КОНКРЕТНЫМ ЗНАЧЕНИЕМ, чтобы не затереть
        // чужой claim, если строку успел занять кто-то ещё.
        await this.prisma.ticket.updateMany({
          where: { id: t.id, taskCreatedAt: ctx.now },
          data: { taskCreatedAt: null },
        });
        skipped += 1;
        ctx.logger.error(
          `[${this.name}] не удалось создать задачу по билету ${t.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (usedFounderFallback) {
      await this.notifyMissingManagerOnce(ctx.now);
    }

    return { created, skipped, hasMore: candidates.length === BATCH_SIZE };
  }

  // ------------------------------------------------------------------
  // 2) SMS студенту за сутки до вылета
  // ------------------------------------------------------------------

  private async runSmsReminders(ctx: JobContext): Promise<JobResult> {
    const upperBound = new Date(ctx.now.getTime() + SMS_LEAD_MS);
    // В отличие от задачи менеджеру, «догонять» здесь нечего: SMS про уже
    // состоявшийся вылет бесполезно и выглядит как сбой системы.
    const lowerBound = new Date(ctx.now.getTime() + SMS_MIN_LEAD_MS);

    const candidates = await this.prisma.ticket.findMany({
      where: {
        deletedAt: null,
        smsSentAt: null,
        status: { not: TicketStatus.CANCELLED },
        departureAt: { gte: lowerBound, lte: upperBound },
        student: { is: { deletedAt: null, status: { in: ['ACTIVE', 'PAUSED'] } } },
      },
      orderBy: { departureAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        destinationCity: true,
        departureAt: true,
        flightNumber: true,
        student: { select: { fullName: true, phones: true } },
      },
    });

    let created = 0;
    let skipped = 0;

    for (const t of candidates) {
      const phone = t.student.phones.find((p) => p && p.trim());
      if (!phone) {
        // Телефона нет — занимаем строку всё равно, иначе этот кандидат будет
        // возвращаться в выборку на каждом прогоне и вытеснять реальных.
        await this.prisma.ticket.updateMany({
          where: { id: t.id, smsSentAt: null },
          data: { smsSentAt: ctx.now },
        });
        skipped += 1;
        continue;
      }

      const claimed = await this.prisma.ticket.updateMany({
        where: { id: t.id, smsSentAt: null },
        data: { smsSentAt: ctx.now },
      });
      if (claimed.count !== 1) {
        skipped += 1;
        continue;
      }

      const when = formatLocalDateTime(t.departureAt);
      const text =
        `GrantChina: напоминаем о вылете. Рейс ${t.flightNumber} в ${t.destinationCity}, ` +
        `${when}. Проверьте документы и приезжайте в аэропорт заранее.`;
      // SMS отправляется «в фоне» и её неудача не откатывает claim: провайдер
      // может быть недоступен, но повторная рассылка того же напоминания через
      // час раздражает сильнее, чем одна пропущенная (та же логика, что у
      // остальных уведомлений проекта — .catch(() => undefined)).
      this.sms.send(phone, text).catch(() => undefined);
      created += 1;
    }

    return { created, skipped, hasMore: candidates.length === BATCH_SIZE };
  }

  /** Не спамим одним и тем же уведомлением каждый час, пока не назначены менеджеры. */
  private async notifyMissingManagerOnce(now: Date): Promise<void> {
    const dayStart = localDayStart(now);
    const already = await this.prisma.notification.findFirst({
      where: { type: 'FLIGHT_NO_MANAGER', createdAt: { gte: dayStart } },
    });
    if (already) return;
    await this.notifications.notifyAdminsAndFounders({
      type: 'FLIGHT_NO_MANAGER',
      title: 'Билеты без ответственного менеджера',
      message:
        'Планировщик создал задачу о ближайшем вылете студенту без назначенного менеджера — назначьте ответственного в карточке студента.',
    });
  }
}
