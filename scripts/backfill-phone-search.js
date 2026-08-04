/**
 * ТЗ v3 раздел 1 — заполнение Student.phoneSearch для существующих студентов.
 *
 * Новое поле заполняется само при создании и обновлении студента
 * (buildPhoneSearch в students.service.ts), но 204 записи в боевой базе были
 * созданы раньше — у них phoneSearch пуст, и поиск по телефону их не найдёт.
 * Этот скрипт проходит по ним один раз.
 *
 * ЧЕГО СКРИПТ НЕ ДЕЛАЕТ:
 *   - не удаляет ни одной строки
 *   - не трогает сам массив phones (исходные номера остаются как есть)
 *   - не трогает ничего, кроме phoneSearch
 *
 * ЗАПУСК:
 *   node scripts/backfill-phone-search.js          # только показать план
 *   node scripts/backfill-phone-search.js --apply  # выполнить
 *
 * Повторный запуск безопасен: значение пересчитывается из phones и
 * записывается только если отличается от уже сохранённого.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

/**
 * Копия buildPhoneSearch/normalizePhone из backend/src/common/phone.ts.
 * Скрипт не может импортировать TypeScript напрямую, а тянуть ts-node ради
 * двадцати строк дороже, чем продублировать их с явной пометкой.
 * ЕСЛИ МЕНЯЕТСЯ ФОРМУЛА В phone.ts — ОБЯЗАТЕЛЬНО ПОПРАВИТЬ И ЗДЕСЬ, иначе
 * бэкфилл запишет одно, а живой код при следующей правке студента — другое.
 */
const MIN_PHONE_QUERY_DIGITS = 3;

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (digits.length === 12 && digits.startsWith('992')) return digits.slice(-9);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function buildPhoneSearch(phones) {
  if (!phones || phones.length === 0) return null;
  const parts = new Set();
  for (const raw of phones) {
    if (!raw) continue;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length >= MIN_PHONE_QUERY_DIGITS) parts.add(digits);
    const normalized = normalizePhone(raw);
    if (normalized) parts.add(normalized);
  }
  return parts.size ? [...parts].join(' ') : null;
}

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

async function main() {
  // Берём ВСЕХ, включая мягко удалённых: удалённого студента могут
  // восстановить, и его телефон должен искаться сразу, а не после
  // следующей правки карточки.
  const students = await prisma.student.findMany({
    select: { id: true, fullName: true, phones: true, phoneSearch: true },
  });

  const toUpdate = [];
  let alreadyOk = 0;
  let noPhone = 0;

  for (const s of students) {
    const next = buildPhoneSearch(s.phones);
    if (next === null) {
      noPhone++;
      continue;
    }
    if (s.phoneSearch === next) {
      alreadyOk++;
      continue;
    }
    toUpdate.push({ id: s.id, fullName: s.fullName, phones: s.phones, next });
  }

  console.log(`Всего студентов:        ${students.length}`);
  console.log(`Без телефона:           ${noPhone}`);
  console.log(`Уже заполнено верно:    ${alreadyOk}`);
  console.log(`Требуется заполнить:    ${toUpdate.length}\n`);

  if (toUpdate.length) {
    console.log('Примеры (первые 8):');
    for (const s of toUpdate.slice(0, 8)) {
      console.log(`  ${s.fullName.slice(0, 26).padEnd(28)} ${JSON.stringify(s.phones)}  ->  «${s.next}»`);
    }
  }

  if (!APPLY) {
    console.log('\nНичего не изменено. Для выполнения: node scripts/backfill-phone-search.js --apply');
    return;
  }

  console.log('\n--- ВЫПОЛНЕНИЕ ---');
  let done = 0;
  for (const s of toUpdate) {
    await prisma.student.update({ where: { id: s.id }, data: { phoneSearch: s.next } });
    done++;
    if (done % 50 === 0) console.log(`  обработано ${done} из ${toUpdate.length}`);
  }
  console.log(`  обработано ${done} из ${toUpdate.length}`);

  // Проверка: после бэкфилла у каждого студента с телефоном поле заполнено.
  const stillEmpty = await prisma.student.count({
    where: { phoneSearch: null, NOT: { phones: { isEmpty: true } } },
  });
  console.log(`\nСВЕРКА: студентов с телефоном, но без поисковой строки: ${stillEmpty}`);
  if (stillEmpty > 0) {
    console.error('Часть записей осталась незаполненной — проверьте формат их phones[].');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('ОШИБКА:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
