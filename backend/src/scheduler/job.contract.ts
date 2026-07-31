import { Logger } from '@nestjs/common';

export interface JobContext {
  /** Момент запуска в UTC — как хранится всё в БД. */
  now: Date;
  /** Тот же момент, сдвинутый на часовой пояс Таджикистана (см. scheduler/time.ts). */
  localNow: Date;
  logger: Logger;
}

export interface JobResult {
  /** Сколько строк реально создано/изменено этим прогоном. */
  created: number;
  /** Сколько кандидатов пропущено: уже обработаны (дубль), вне окна, кто-то другой занял. */
  skipped: number;
  /** true — есть ещё необработанные кандидаты, оркестратор повторит джобу в этом же тике (до лимита). */
  hasMore: boolean;
}

/**
 * Переиспользуемая основа планировщика (волна 3: напоминания о повторных
 * звонках + авто-архив заявок; волна 4 добавит напоминание о начале
 * учебного года как ЕЩЁ ОДНУ реализацию этого интерфейса — файл + одна
 * строка в SchedulerModule.providers, оркестратор не меняется).
 *
 * ИДЕМПОТЕНТНОСТЬ — ответственность самой джобы, оркестратор (scheduler.service.ts)
 * её не гарантирует, только экономит работу через захват (scheduler-lock.service.ts).
 * Разрешены ТРИ паттерна. Запрещено смешивать их с «сначала findFirst, потом
 * create/update» — между двумя запросами живёт гонка (два инстанса Railway,
 * повторный тик, ручной запуск через POST /scheduler/run/:job).
 *
 *  A. UNIQUE-INSERT. Создание строки с уникальным ключом (Task.originKey).
 *     Гонку арбитрирует БД: второй INSERT падает с P2002, ловится и
 *     считается как skipped (см. TasksService.createSystemTask()).
 *
 *  B. CLAIM-FLAG. Перед побочным эффектом (письмо, задача) строка атомарно
 *     занимается условным UPDATE:
 *       const claimed = await prisma.consultation.updateMany({
 *         where: { id, reminderSentAt: null },
 *         data: { reminderSentAt: now },
 *       });
 *       if (claimed.count !== 1) continue; // кто-то другой уже занял
 *     Побочный эффект (уведомление) шлётся ТОЛЬКО после claimed.count === 1.
 *
 *  C. ЖЕЛАЕМОЕ СОСТОЯНИЕ. Массовый updateMany с условием, которое перестаёт
 *     выполняться после первого применения:
 *       updateMany({ where: { archivedAt: null, status, updatedAt: { lt: cutoff } },
 *                    data: { archivedAt: now } })
 *     Повторный прогон находит 0 строк — идемпотентно по построению.
 */
export interface ScheduledJob {
  /** Стабильный идентификатор — он же SchedulerRun.job. НЕ переименовывать после выката. */
  readonly name: string;
  /** Собственный ритм джобы в минутах. Оркестратор тикает раз в 15 минут и пропускает джобы, которые отработали недавно. */
  readonly everyMinutes: number;
  run(ctx: JobContext): Promise<JobResult>;
}

/** DI-токен мульти-провайдера — список джоб собирает scheduler.module.ts. */
export const SCHEDULED_JOBS = 'SCHEDULED_JOBS';
