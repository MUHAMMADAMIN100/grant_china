/**
 * Одноразовый скрипт повышения сотрудника до роли FOUNDER (Основатель).
 *
 * FOUNDER — единственная роль, которая может редактировать сотрудников,
 * менять им пароли и назначать роли. ADMIN видит список read-only.
 *
 * НЕ удаляет данные — только UPDATE поля role у одного юзера.
 *
 * Запуск:
 *   # default — admin@grantchina.local → FOUNDER
 *   ts-node prisma/upgrade-founder.ts
 *
 *   # custom через env
 *   FOUNDER_EMAIL=ceo@grantchina.local ts-node prisma/upgrade-founder.ts
 *
 * На Railway (через pre-deploy step):
 *   FOUNDER_EMAIL=ceo@example.com npm run upgrade:founder
 */
import { PrismaClient, Role } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  const rawEmail = process.env.FOUNDER_EMAIL || 'admin@grantchina.local';
  const email = rawEmail.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`❌ Пользователь "${email}" не найден в БД.`);
    console.error('   Сначала создай его через CRM или сидер, затем запусти скрипт.');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (user.role === Role.FOUNDER) {
    console.log(`ℹ️  "${email}" уже имеет роль FOUNDER — ничего не меняем.`);
    await prisma.$disconnect();
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role: Role.FOUNDER },
  });

  console.log(`✅ Роль "${email}" (${user.fullName}) изменена: ${user.role} → FOUNDER.`);
  console.log('   Теперь этот пользователь может редактировать сотрудников и роли.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Ошибка:', e);
  process.exit(1);
});
