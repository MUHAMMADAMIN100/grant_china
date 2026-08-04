/**
 * Разовая кадровая операция: смена роли и региона сотрудников.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ РАЗДЕЛ «ПОЛЬЗОВАТЕЛИ» В ИНТЕРФЕЙСЕ. Это тот же
 * результат, что даёт форма, но применённый ко всем нужным людям разом и
 * зафиксированный в git: после перехода на ТЗ v3 Администратор теряет право
 * записи в финансах, а два человека с этой ролью фактически работали
 * менеджерами и вели 199 студентов из 201. Их надо перевести одним движением,
 * иначе между деплоем и ручной правкой они не смогут внести ни одного платежа.
 *
 * ЧТО ДЕЛАЕТ:
 *   - меняет role и/или region у перечисленных ниже сотрудников;
 *   - пишет в журнал активности те же записи, что написал бы UsersService
 *     (USER_ROLE_CHANGE / USER_REGION_CHANGE) — кадровое событие обязано быть
 *     видно Основателю, а прямая правка БД журнал не заполняет;
 *   - НИЧЕГО не удаляет и не трогает другие поля (пароль, email, привязки
 *     студентов остаются как есть).
 *
 * ПОСЛЕ ВЫПОЛНЕНИЯ новые права применятся в течение 30 секунд — столько живёт
 * кэш сессии в backend/src/auth/jwt.strategy.ts. Перезапускать сервис не нужно.
 *
 * ЗАПУСК:
 *   node scripts/set-user-role-region.js          # только показать план
 *   node scripts/set-user-role-region.js --apply  # выполнить
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

/**
 * Кого и во что переводим. Ключ — email (он уникален и не меняется при смене
 * ФИО). Значение null у поля означает «не трогать».
 */
const PLAN = [
  // ТЗ v3 раздел 4: фактические менеджеры по Таджикистану, до сих пор
  // числившиеся Администраторами. Роль «Менеджер» + регион «Таджикистан»
  // сохраняет им работу с их студентами и платежами по ним, но закрывает
  // общую аналитику и чужих студентов — ровно как описано в таблице ролей.
  { email: 'mabatshoevao@mail.ru', role: 'EMPLOYEE', region: 'TJ' },      // Zumratshoeva Ozoda, 117 студентов
  { email: 'soro.navruzbekova.01@mail.ru', role: 'EMPLOYEE', region: 'TJ' }, // Navruzbekova Soro, 82 студента
];

// НЕ ВКЛЮЧЁН В ПЛАН СОЗНАТЕЛЬНО: Nur (n.boyboboeva@gmail.com) — тоже
// Администратор и тоже ведёт студента (одного). После перехода он не сможет
// вносить по нему платежи. Решение по нему заказчик не принимал, а менять
// роль человека «заодно» нельзя: либо перевести его тем же способом, либо
// передать этого студента другому менеджеру.

function resolveDatabaseUrl() {
  if (process.env.GC_DB_URL) return { url: process.env.GC_DB_URL, source: 'GC_DB_URL' };
  const files = [
    path.join(REPO, 'backend', '.env.production.local'),
    path.join(REPO, 'backend', '.env'),
  ];
  for (const envPath of files) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
      if (!m) continue;
      let val = m[1].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val) return { url: val, source: path.basename(envPath) };
    }
  }
  return { url: process.env.DATABASE_URL || '', source: 'process.env' };
}

const { url: DB_URL, source: DB_SOURCE } = resolveDatabaseUrl();
if (!DB_URL) {
  console.error('DATABASE_URL не найден');
  process.exit(1);
}
console.log(`БД (${DB_SOURCE}): ${DB_URL.replace(/:\/\/([^:]+):([^@]*)@/, '://$1:***@')}`);
console.log(APPLY ? 'РЕЖИМ: ВЫПОЛНЕНИЕ\n' : 'РЕЖИМ: только показать план (для выполнения добавьте --apply)\n');

const { PrismaClient } = require(path.join(REPO, 'backend', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

const ROLE_LABEL = { FOUNDER: 'Основатель', ADMIN: 'Администратор', EMPLOYEE: 'Менеджер' };
const REGION_LABEL = { TJ: 'Таджикистан', CN: 'Китай', BOTH: 'Оба региона' };

async function main() {
  const founder = await prisma.user.findFirst({ where: { role: 'FOUNDER', deletedAt: null }, select: { id: true, fullName: true } });

  const steps = [];
  for (const item of PLAN) {
    const user = await prisma.user.findFirst({
      where: { email: item.email, deletedAt: null },
      select: { id: true, email: true, fullName: true, role: true, region: true },
    });
    if (!user) {
      console.log(`  НЕ НАЙДЕН: ${item.email}`);
      continue;
    }
    const tj = await prisma.student.count({ where: { deletedAt: null, managerId: user.id } });
    const cn = await prisma.student.count({ where: { deletedAt: null, chinaManagerId: user.id } });
    const roleChanges = item.role && item.role !== user.role;
    const regionChanges = item.region && item.region !== user.region;
    console.log(
      `  ${user.fullName.padEnd(26)} студентов TJ:${String(tj).padStart(4)} CN:${String(cn).padStart(4)}   ` +
        `${roleChanges ? `роль ${ROLE_LABEL[user.role]} → ${ROLE_LABEL[item.role]}` : `роль ${ROLE_LABEL[user.role]} (без изменений)`}` +
        `, ${regionChanges ? `регион ${REGION_LABEL[user.region]} → ${REGION_LABEL[item.region]}` : `регион ${REGION_LABEL[user.region]} (без изменений)`}`,
    );
    if (roleChanges || regionChanges) steps.push({ user, item, roleChanges, regionChanges });
  }

  console.log(`\nК изменению: ${steps.length}`);
  if (!APPLY) {
    console.log('Ничего не изменено. Для выполнения: node scripts/set-user-role-region.js --apply');
    return;
  }

  // Защита от потери последнего Основателя — та же, что в UsersService.
  // Здесь план Основателей не трогает, но проверка стоит на случай правки PLAN.
  const founderCount = await prisma.user.count({ where: { role: 'FOUNDER', deletedAt: null } });
  const demotesFounder = steps.some((s) => s.user.role === 'FOUNDER' && s.item.role && s.item.role !== 'FOUNDER');
  if (demotesFounder && founderCount <= 1) {
    console.error('ОТКАЗ: план оставил бы систему без Основателя');
    process.exitCode = 1;
    return;
  }

  console.log('\n--- ВЫПОЛНЕНИЕ ---');
  for (const { user, item, roleChanges, regionChanges } of steps) {
    const data = {};
    if (roleChanges) data.role = item.role;
    if (regionChanges) data.region = item.region;
    await prisma.user.update({ where: { id: user.id }, data });

    // Журнал — теми же действиями, что пишет UsersService, чтобы кадровая
    // история не разошлась в зависимости от того, через что меняли.
    if (roleChanges) {
      await prisma.activityLog.create({
        data: {
          actorId: founder?.id ?? null,
          actorName: founder?.fullName ?? 'Системная операция',
          actorRole: 'FOUNDER',
          action: 'USER_ROLE_CHANGE',
          details: `${user.fullName} (${user.email}): роль ${ROLE_LABEL[user.role]} → ${ROLE_LABEL[item.role]}`,
          payload: { userId: user.id, before: user.role, after: item.role, source: 'scripts/set-user-role-region.js' },
        },
      });
    }
    if (regionChanges) {
      await prisma.activityLog.create({
        data: {
          actorId: founder?.id ?? null,
          actorName: founder?.fullName ?? 'Системная операция',
          actorRole: 'FOUNDER',
          action: 'USER_REGION_CHANGE',
          details: `${user.fullName} (${user.email}): регион ${REGION_LABEL[user.region]} → ${REGION_LABEL[item.region]}`,
          payload: { userId: user.id, before: user.region, after: item.region, source: 'scripts/set-user-role-region.js' },
        },
      });
    }
    console.log(`  ${user.fullName}: готово`);
  }

  console.log('\n--- ПОСЛЕ ---');
  const all = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { fullName: true, role: true, region: true },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
  });
  for (const u of all) {
    console.log(`  ${ROLE_LABEL[u.role].padEnd(14)} ${REGION_LABEL[u.region].padEnd(14)} ${u.fullName}`);
  }
  console.log('\nНовые права применятся в течение 30 секунд (кэш сессии).');
}

main()
  .catch((e) => { console.error('ОШИБКА:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
