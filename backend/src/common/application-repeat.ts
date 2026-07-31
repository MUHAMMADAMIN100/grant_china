import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Раздел 3.1 ТЗ — «повторное обращение». Общая формула для ДВУХ вызывающих:
 * applications.service.create() (заявка с лендинга/CRM) и
 * consultations.service.convert() (заявка, рождённая из консультации) —
 * без общего места эти две реализации гарантированно разъехались бы со
 * временем (тот же довод, что вынес canAccessStudentRecord в common/access.ts).
 *
 * Ключ склейки — НОРМАЛИЗОВАННЫЙ телефон, вторым (OR) ключом — email
 * (регистронезависимо), если он непустой. repeatOfId ставится на ПЕРВУЮ
 * (самую раннюю, deletedAt: null) заявку с тем же ключом — если у неё самой
 * уже есть repeatOfId, возвращаем ЕГО (корень цепочки), а не её id: тогда все
 * обращения одного человека имеют ОДИН repeatOfId и группируются одним
 * индексным запросом, без рекурсии по цепочке.
 *
 * КРИТИЧНО: без переданных ключей (оба null/пусто) поиск обязан вернуть null
 * ДО запроса, а не идти в БД — иначе `where: { OR: [] }` эквивалентен
 * "без условия" и Prisma подберёт первую попавшуюся заявку в базе, склеив
 * между собой всех людей без телефона и email (заявки из students.service
 * с `phones[0] || ''` — штатный случай такого пустого номера).
 */
export async function findRepeatOfId(
  prisma: PrismaService,
  phoneNormalized: string | null,
  email: string | null,
): Promise<string | null> {
  const or: Prisma.ApplicationWhereInput[] = [];
  if (phoneNormalized) or.push({ phoneNormalized });
  if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
  if (!or.length) return null;

  const earliest = await prisma.application.findFirst({
    where: { deletedAt: null, OR: or },
    orderBy: { createdAt: 'asc' },
    select: { id: true, repeatOfId: true },
  });
  if (!earliest) return null;
  return earliest.repeatOfId ?? earliest.id;
}
