/**
 * ТЗ v3 раздел 4 — проставление региона менеджерам по фактическим данным.
 *
 * Поле User.region добавлено со значением по умолчанию BOTH: это сохраняет
 * поведение системы ровно таким, каким оно было до разделения по регионам, и
 * гарантирует, что деплой никого не отрежет от работы. Но пока у всех стоит
 * BOTH, требование ТЗ «менеджер видит только свой регион» не действует.
 *
 * Скрипт выводит регион из ТОГО, кем сотрудник фактически назначен:
 *   есть студенты только по managerId       -> TJ  (ведение в Таджикистане)
 *   есть студенты только по chinaManagerId  -> CN  (сопровождение в Китае)
 *   есть и те и другие                      -> BOTH
 *   студентов нет вовсе                     -> BOTH (не сужаем вслепую)
 *
 * ТОЛЬКО ДЛЯ РОЛИ EMPLOYEE. У Основателя и Администратора регион ни на что не
 * влияет (по ТЗ они видят всех студентов Таджикистана и Китая), и трогать их
 * значит создавать ложное впечатление, будто оно что-то ограничивает.
 *
 * ЧЕГО СКРИПТ НЕ ДЕЛАЕТ:
 *   - не удаляет ни одной строки
 *   - НЕ МЕНЯЕТ РОЛИ. Смена роли — кадровое решение, а не следствие подсчёта
 *     студентов, и делается руками в разделе «Пользователи».
 *   - не трогает сотрудников, у которых регион уже отличается от BOTH
 *     (значит его уже проставили осознанно)
 *
 * ЗАПУСК:
 *   node scripts/backfill-user-region.js          # только показать план
 *   node scripts/backfill-user-region.js --apply  # выполнить
 *
 * ВАЖНО ПОСЛЕ ВЫПОЛНЕНИЯ: у бэкенда есть кэш сессии на 30 секунд
 * (jwt.strategy.ts). Новый регион применится в течение полуминуты — это
 * нормально, перезапускать сервис не нужно.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

function resolveDatabaseUrl() {
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

const REGION_LABEL = { TJ: 'Таджикистан', CN: 'Китай', BOTH: 'Оба региона' };

async function main() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, fullName: true, email: true, role: true, region: true },
    orderBy: { fullName: 'asc' },
  });

  console.log('Сотрудник                      Роль       TJ    CN   регион сейчас -> станет');
  console.log('-'.repeat(88));

  const plan = [];
  for (const u of users) {
    const tj = await prisma.student.count({ where: { deletedAt: null, managerId: u.id } });
    const cn = await prisma.student.count({ where: { deletedAt: null, chinaManagerId: u.id } });

    let next = u.region;
    let reason = '';
    if (u.role !== 'EMPLOYEE') {
      reason = 'не менеджер — регион не влияет';
    } else if (u.region !== 'BOTH') {
      reason = 'регион уже проставлен вручную';
    } else if (tj > 0 && cn === 0) {
      next = 'TJ';
    } else if (cn > 0 && tj === 0) {
      next = 'CN';
    } else if (tj > 0 && cn > 0) {
      reason = 'ведёт оба направления';
    } else {
      reason = 'студентов нет — не сужаем вслепую';
    }

    const change = next !== u.region ? `${REGION_LABEL[u.region]} -> ${REGION_LABEL[next]}` : `${REGION_LABEL[u.region]} (${reason})`;
    console.log(
      `${u.fullName.slice(0, 28).padEnd(30)} ${u.role.padEnd(9)} ${String(tj).padStart(4)} ${String(cn).padStart(5)}   ${change}`,
    );
    if (next !== u.region) plan.push({ id: u.id, fullName: u.fullName, from: u.region, to: next });
  }

  console.log(`\nК изменению: ${plan.length}`);

  if (!APPLY) {
    console.log('Ничего не изменено. Для выполнения: node scripts/backfill-user-region.js --apply');
    return;
  }

  console.log('\n--- ВЫПОЛНЕНИЕ ---');
  for (const p of plan) {
    await prisma.user.update({ where: { id: p.id }, data: { region: p.to } });
    console.log(`  ${p.fullName}: ${REGION_LABEL[p.from]} -> ${REGION_LABEL[p.to]}`);
  }
  console.log(`\nГотово: ${plan.length}. Новый регион применится в течение 30 секунд (кэш сессии).`);
}

main()
  .catch((e) => { console.error('ОШИБКА:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
