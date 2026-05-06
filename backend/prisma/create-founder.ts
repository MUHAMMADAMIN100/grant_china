/**
 * Одноразовый скрипт создания Основателя (FOUNDER) с нуля.
 *
 * Если юзер с таким email уже есть — повышает его до FOUNDER (и опционально
 * обновляет пароль/ФИО, если переменные переданы). Если нет — создаёт.
 *
 * НЕ удаляет данные.
 *
 * Запуск:
 *   FOUNDER_EMAIL=ceo@grantchina.local \
 *   FOUNDER_PASSWORD=SuperSecret123 \
 *   FOUNDER_NAME="Иван Иванов" \
 *   ts-node prisma/create-founder.ts
 *
 * На Railway (через pre-deploy step):
 *   FOUNDER_EMAIL=ceo@example.com FOUNDER_PASSWORD=Strong123 FOUNDER_NAME="CEO" npm run create:founder
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const prisma = new PrismaClient();

  const rawEmail = process.env.FOUNDER_EMAIL;
  const rawPassword = process.env.FOUNDER_PASSWORD;
  const rawName = process.env.FOUNDER_NAME;

  if (!rawEmail || !rawPassword || !rawName) {
    console.error('❌ Не заданы обязательные переменные окружения.');
    console.error('   Нужны: FOUNDER_EMAIL, FOUNDER_PASSWORD, FOUNDER_NAME');
    console.error('   Пример: FOUNDER_EMAIL=ceo@grantchina.local FOUNDER_PASSWORD=Strong123 FOUNDER_NAME="Иван" npm run create:founder');
    await prisma.$disconnect();
    process.exit(1);
  }

  const email = rawEmail.trim().toLowerCase();
  const password = rawPassword.trim();
  const fullName = rawName.trim();

  if (password.length < 8) {
    console.error('❌ Пароль должен быть минимум 8 символов.');
    await prisma.$disconnect();
    process.exit(1);
  }
  if (fullName.length < 2) {
    console.error('❌ ФИО должно быть минимум 2 символа.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  const hashedPassword = await bcrypt.hash(password, 10);

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: Role.FOUNDER,
        password: hashedPassword,
        fullName,
      },
    });
    console.log(`✅ Существующий пользователь "${email}" обновлён:`);
    console.log(`   • Роль: ${existing.role} → FOUNDER`);
    console.log(`   • ФИО: ${existing.fullName} → ${fullName}`);
    console.log(`   • Пароль: установлен новый ("${password}")`);
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName,
        role: Role.FOUNDER,
      },
    });
    console.log(`✅ Создан новый Основатель: ${created.fullName} <${created.email}>`);
    console.log(`   • Роль: FOUNDER`);
    console.log(`   • Пароль: "${password}"`);
  }

  console.log('');
  console.log('🔐 Войти в CRM:');
  console.log(`   Email: ${email}`);
  console.log(`   Пароль: ${password}`);
  console.log('   После первого входа — сразу смени пароль через профиль.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Ошибка:', e);
  process.exit(1);
});
