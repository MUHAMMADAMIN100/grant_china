import { Injectable } from '@nestjs/common';
import { GrantStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TasksService } from '../../tasks/tasks.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { JobContext, JobResult, ScheduledJob } from '../job.contract';
import { localDayStart, localHour } from '../time';
import { academicYearOriginKey, formatDateRuShort, ordinalYearRu } from '../../grants/grant-year';

// Раздел 4 ТЗ — «за 1–2 месяца до старта нового учебного года CRM автоматически
// создаёт задачу». Верхняя граница окна = «за 2 месяца» (раньше задача не
// появится), нижняя граница dueDate = «за 1 месяц» (к этому сроку задачу
// нужно выполнить). См. academicYearJob проекта архитектора.
const WINDOW_FORWARD_MS = 60 * 24 * 60 * 60 * 1000; // +60 дней
// Грейс НАЗАД: грант, заведённый в CRM позже, чем за месяц до старта, всё
// равно должен породить звонок — без грейса такие студенты молча выпадали
// бы из окна. 7 дней (а не больше), чтобы ретроспективный ввод исторических
// грантов не выстрелил лавиной задач.
const WINDOW_BACKWARD_MS = 7 * 24 * 60 * 60 * 1000;
// dueDate = max(nextYearStartsAt − 30 дней, now + 1 день) — не даёт задаче
// родиться уже просроченной, если грант завели поздно.
const DUE_LEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_DUE_LEAD_MS = 24 * 60 * 60 * 1000;

// Жёсткий лимит на прогон — первый прогон на 197 студентах (сейчас 0 грантов
// в реестре — бэкфилла нет, см. grantModel проекта архитектора) не должен
// завалить менеджеров сотней задач разом. Остаток подберёт следующий тик
// (оркестратор повторяет джобу до MAX_BATCHES_PER_RUN раз за один вызов).
const BATCH_SIZE = 100;

// «Тихие часы» по Душанбе — тот же приём, что в follow-up-reminder.job.ts.
const ALLOWED_HOUR_START = 9;
const ALLOWED_HOUR_END = 20;

/**
 * Раздел 4 ТЗ — напоминание менеджеру о начале нового учебного года по
 * гранту (2-й и последующие годы). Работает НАПРЯМУЮ с prisma.studentGrant,
 * а не через GrantsService: джоба — инфраструктура планировщика, а не
 * потребитель HTTP-сервиса с ролевыми проверками под конкретного пользователя
 * (тот же приём, что у follow-up-reminder.job.ts и prisma.consultation).
 */
@Injectable()
export class AcademicYearReminderJob implements ScheduledJob {
  readonly name = 'academic-year-reminder';
  readonly everyMinutes = 60;

  constructor(
    private prisma: PrismaService,
    private tasks: TasksService,
    private notifications: NotificationsService,
  ) {}

  async run(ctx: JobContext): Promise<JobResult> {
    const hour = localHour(ctx.now);
    if (hour < ALLOWED_HOUR_START || hour >= ALLOWED_HOUR_END) {
      return { created: 0, skipped: 0, hasMore: false };
    }

    const lowerBound = new Date(ctx.now.getTime() - WINDOW_BACKWARD_MS);
    const upperBound = new Date(ctx.now.getTime() + WINDOW_FORWARD_MS);

    const candidates = await this.prisma.studentGrant.findMany({
      where: {
        deletedAt: null,
        status: GrantStatus.ACTIVE,
        reminderSentAt: null,
        nextYearStartsAt: { not: null, gte: lowerBound, lte: upperBound },
        // Статус студента фильтруем В ЗАПРОСЕ, а не после выборки.
        // Отбракованный после take: BATCH_SIZE кандидат не помечается
        // claim'ом и потому возвращается в выборку на КАЖДОМ прогоне.
        // Накопится 100 таких (отчисленные, выпустившиеся, архивные) —
        // и они займут весь батч, вытеснив реальных кандидатов: джоба
        // будет крутиться вхолостую, а напоминания перестанут приходить.
        // PAUSED (академотпуск) в список намеренно НЕ входит: студент
        // вернётся в ACTIVE внутри окна, и напоминание сработает.
        student: { is: { deletedAt: null, status: 'ACTIVE' } },
      },
      orderBy: { nextYearStartsAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        currentYear: true,
        totalYears: true,
        nextYearStartsAt: true,
        university: true,
        name: true,
        createdById: true,
        student: {
          select: { id: true, fullName: true, phones: true, status: true, managerId: true, chinaManagerId: true },
        },
      },
    });

    let created = 0;
    let skipped = 0;
    let usedFounderFallback = false;
    // Первый живой FOUNDER — фолбэк-исполнитель, запрашивается лениво и
    // максимум один раз за прогон (не на каждого кандидата).
    let cachedFounderId: string | null | undefined;

    for (const g of candidates) {
      // Отчисленный/выпущенный/архивный студент звонка не получает. PAUSED
      // (академ) — тоже, но БЕЗ claim'а: вернётся в ACTIVE внутри окна —
      // напоминание сработает при следующем прогоне.
      if (g.student.status !== 'ACTIVE') {
        skipped += 1;
        continue;
      }
      // Нарушенный инвариант (кто-то вручную уменьшил totalYears после
      // advance()) — джоба его не чинит, но и не молчит.
      if (g.currentYear >= g.totalYears || !g.nextYearStartsAt) {
        ctx.logger.warn(
          `[${this.name}] грант ${g.id} нарушает инвариант (currentYear=${g.currentYear}, totalYears=${g.totalYears}, nextYearStartsAt=${g.nextYearStartsAt}) — пропущен`,
        );
        skipped += 1;
        continue;
      }

      // ТЗ 4 — «задачу для ответственного менеджера»: цепочка фолбэков,
      // потому что молчание («не позвонили никому») хуже, чем звонок от
      // не совсем точного исполнителя.
      //
      // Кандидат в исполнители обязан быть ЖИВЫМ сотрудником. Увольнение
      // (soft-delete) НЕ обнуляет managerId у студентов, а
      // TasksService.createSystemTask на удалённого исполнителя бросает
      // NotFoundException — claim откатывается, задача не создаётся, и
      // ошибка повторяется каждый час до бесконечности. Проверяем заранее
      // и спускаемся по цепочке фолбэков дальше.
      const aliveIds = new Set<string>();
      {
        const maybe = [g.student.managerId, g.student.chinaManagerId, g.createdById].filter(
          (v): v is string => !!v,
        );
        if (maybe.length) {
          const alive = await this.prisma.user.findMany({
            where: { id: { in: maybe }, deletedAt: null },
            select: { id: true },
          });
          alive.forEach((u) => aliveIds.add(u.id));
        }
      }
      const pick = (id: string | null | undefined): string | null =>
        id && aliveIds.has(id) ? id : null;

      let assigneeId: string | null = pick(g.student.managerId) ?? pick(g.student.chinaManagerId);
      let usedFallback = false;
      if (!assigneeId) {
        usedFallback = true;
        assigneeId = pick(g.createdById);
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
        // В проде невозможно (хотя бы один FOUNDER всегда есть) — но не
        // роняем прогон целиком из-за одного кандидата без исполнителя.
        skipped += 1;
        continue;
      }

      // Паттерн B (claim-flag, job.contract.ts): атомарно занимаем строку
      // ДО создания задачи — только владелец claim'а её создаёт.
      const claimed = await this.prisma.studentGrant.updateMany({
        where: { id: g.id, reminderSentAt: null },
        data: { reminderSentAt: ctx.now },
      });
      if (claimed.count !== 1) {
        skipped += 1; // кто-то другой (второй инстанс/повторный тик) уже занял
        continue;
      }

      const n = g.currentYear + 1; // год, который скоро начнётся
      const dueDate = new Date(
        Math.max(g.nextYearStartsAt.getTime() - DUE_LEAD_MS, ctx.now.getTime() + MIN_DUE_LEAD_MS),
      );
      // Календарный год (по Душанбе) старта нового учебного года — а не
      // порядковый номер курса. См. academicYearJob проекта архитектора:
      // порядковый ключ терял бы звонок студентам, оставшимся на второй год
      // или ушедшим в академ, календарный — переигрывает в новом году.
      //
      // В ключ входит id ГРАНТА, а не только студента. Схема допускает
      // несколько грантов у одного человека — это буквально «двойной грант»
      // из названия раздела: год языковых курсов по одному гранту, затем
      // бакалавриат по другому. Если оба многолетние и стартуют в одном
      // календарном году (оба сентябрьские), ключ без grantId совпал бы,
      // второй INSERT упал бы на unique, и менеджер получил бы напоминание
      // ровно по одному из двух грантов — молча, потому что P2002 глотается
      // как «дубль». studentId в ключе оставлен для читаемости в логах.
      // Сам ключ строит grants/grant-year.ts: тот же формат нужен
      // GrantsService.update(), который синхронизирует задачу при переносе даты.
      const originKey = academicYearOriginKey(g.student.id, g.id, g.nextYearStartsAt);

      const lines = [
        `Позвонить студенту ${g.student.fullName} и проинформировать о начале ${ordinalYearRu(n)} года обучения по гранту.`,
      ];
      if (g.student.phones.length) lines.push(`Телефон: ${g.student.phones.join(', ')}`);
      const grantLabel = [g.name, g.university].filter(Boolean).join(' — ');
      if (grantLabel) lines.push(`Грант: ${grantLabel}`);
      lines.push(`Начало учебного года: ${formatDateRuShort(g.nextYearStartsAt)}`);
      lines.push(`Год ${n} из ${g.totalYears}`);
      if (usedFallback) {
        lines.push('У студента не назначен ответственный менеджер — назначьте его в карточке.');
      }

      try {
        await this.tasks.createSystemTask({
          title: `Новый учебный год по гранту: ${g.student.fullName}`,
          description: lines.join('\n'),
          assignedToId: assigneeId,
          dueDate,
          originKey,
        });
        created += 1;
        if (usedFallback) usedFounderFallback = true;
      } catch (e) {
        // Откатываем claim СРАВНЕНИЕМ С КОНКРЕТНЫМ ЗНАЧЕНИЕМ (не просто
        // `reminderSentAt: null`), чтобы не затереть чужой claim, если между
        // нашей записью и откатом строку успел занять кто-то ещё. Иначе
        // один сбой почты/БД навсегда съедал бы напоминание.
        await this.prisma.studentGrant.updateMany({
          where: { id: g.id, reminderSentAt: ctx.now },
          data: { reminderSentAt: null },
        });
        skipped += 1;
        ctx.logger.error(
          `[${this.name}] не удалось создать задачу для гранта ${g.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (usedFounderFallback) {
      await this.notifyMissingManagerOnce(ctx.now);
    }

    // Наблюдаемость (риск проекта: «молчащий планировщик — самый частый и
    // самый незаметный отказ») — логируем итог КАЖДОГО прогона.
    ctx.logger.log(`[${this.name}] кандидатов: ${candidates.length}, создано: ${created}, пропущено: ${skipped}`);

    return { created, skipped, hasMore: candidates.length === BATCH_SIZE };
  }

  /** Не спамим одним и тем же уведомлением каждый час, пока не назначены менеджеры. */
  private async notifyMissingManagerOnce(now: Date): Promise<void> {
    const dayStart = localDayStart(now);
    const already = await this.prisma.notification.findFirst({
      where: { type: 'ACADEMIC_YEAR_NO_MANAGER', createdAt: { gte: dayStart } },
    });
    if (already) return;
    await this.notifications.notifyAdminsAndFounders({
      type: 'ACADEMIC_YEAR_NO_MANAGER',
      title: 'Гранты без ответственного менеджера',
      message:
        'Планировщик создал задачу «Новый учебный год» студенту без назначенного менеджера — назначьте ответственного в карточке студента.',
    });
  }
}
