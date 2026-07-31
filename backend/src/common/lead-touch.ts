import { PrismaService } from '../prisma/prisma.service';

/**
 * Раздел 5 ТЗ (волна 6) — вехи воронки заявки, на которых считается KPI
 * менеджеров (ТЗ 5.1). Обе функции — claim-апдейт (паттерн B/C из
 * scheduler/job.contract.ts): ставятся РОВНО ОДИН РАЗ за жизнь заявки,
 * условие `firstTouchAt: null` / `enrolledAt: null` в WHERE делает повторный
 * вызов идемпотентным no-op, гонки между параллельными запросами
 * арбитрирует БД, а не код.
 *
 * АТРИБУЦИЯ: managerId заявки НА МОМЕНТ вехи, а не actorId — заслуга
 * остаётся у закреплённого менеджера, даже если действие фактически нажал
 * администратор за него. Если менеджер не назначен — используется actorId
 * (тот, кто совершил действие), иначе веха не досталась бы никому.
 */

/** ТЗ 5.1 — веха «лид обработан» (Application.firstTouchAt/firstTouchById). */
export async function claimFirstTouch(
  prisma: PrismaService,
  applicationId: string,
  managerId: string | null,
  actorId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.application.updateMany({
    where: { id: applicationId, firstTouchAt: null },
    data: { firstTouchAt: now, firstTouchById: managerId ?? actorId },
  });
}

/**
 * ТЗ 5.1 — веха «доведён до зачисления» (Application.enrolledAt/enrolledById).
 * НЕОБРАТИМА: откат статуса заявки назад её не обнуляет — «дошёл хотя бы
 * раз» это факт истории, который не должен переписываться задним числом.
 */
export async function claimEnrolled(
  prisma: PrismaService,
  applicationId: string,
  managerId: string | null,
  actorId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.application.updateMany({
    where: { id: applicationId, enrolledAt: null },
    data: { enrolledAt: now, enrolledById: managerId ?? actorId },
  });
}
