/**
 * Бэкап боевой БД в JSON — точка отката перед изменениями схемы.
 *
 * pg_dump на машине не установлен, поэтому выгружаем через Prisma Client.
 * Формат: один JSON-файл со всеми таблицами + манифест с количеством строк.
 *
 * ТОЛЬКО ЧТЕНИЕ. Скрипт физически не может изменить данные — использует
 * исключительно findMany().
 *
 *   node scripts/backup-db.js
 *
 * Файл кладётся в scripts/backups/backup-<ISO>.json (в .gitignore).
 */
const fs = require('fs');
const path = require('path');

/**
 * Читает DATABASE_URL из env-файлов. Приоритет:
 *   1. backend/.env.production.local — боевая Railway
 *   2. backend/.env                  — локальная разработка
 * Первый найденный выигрывает.
 *
 * ВАЖНО: значение передаётся в PrismaClient ЯВНО через datasources.
 * Prisma Client при импорте сам подхватывает backend/.env через dotenv,
 * и без явной передачи он молча подключился бы к localhost, даже если
 * process.env.DATABASE_URL мы перезаписали.
 */
function resolveDatabaseUrl() {
  const files = [
    path.join(__dirname, '..', 'backend', '.env.production.local'),
    path.join(__dirname, '..', 'backend', '.env'),
  ];
  for (const envPath of files) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
      if (!m) continue;
      let val = m[1].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val) return { url: val, source: path.basename(envPath) };
    }
  }
  return { url: process.env.DATABASE_URL || '', source: 'process.env' };
}

const { url: DB_URL, source: DB_SOURCE } = resolveDatabaseUrl();
if (!DB_URL) {
  console.error('DATABASE_URL не найден ни в одном env-файле');
  process.exit(1);
}
// Логируем адрес БЕЗ пароля — файл лога может попасть куда угодно.
console.log(`БД (${DB_SOURCE}): ${DB_URL.replace(/:\/\/([^:]+):([^@]*)@/, '://$1:***@')}`);

// Prisma Client живёт в backend/node_modules
const { PrismaClient } = require(path.join(__dirname, '..', 'backend', 'node_modules', '@prisma', 'client'));

const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

// Порядок важен при восстановлении: сначала независимые, потом зависимые.
const MODELS = [
  'user',
  'program',
  'student',
  'application',
  'document',
  'task',
  'notification',
  'activityLog',
];

async function main() {
  const startedAt = new Date().toISOString();
  const dump = {};
  const manifest = {};

  for (const model of MODELS) {
    if (!prisma[model]) {
      console.warn(`  ! модель ${model} отсутствует в Prisma Client — пропускаю`);
      continue;
    }
    const rows = await prisma[model].findMany();
    dump[model] = rows;
    manifest[model] = rows.length;
    console.log(`  ${model.padEnd(14)} ${rows.length}`);
  }

  const outDir = path.join(__dirname, 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `backup-${stamp}.json`);

  // BigInt/Decimal в JSON не сериализуются штатно — приводим к строке.
  const json = JSON.stringify(
    { startedAt, manifest, data: dump },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
  fs.writeFileSync(outFile, json, 'utf8');

  const sizeMb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
  console.log(`\nБэкап: ${outFile}`);
  console.log(`Размер: ${sizeMb} МБ`);
  console.log(`Всего строк: ${Object.values(manifest).reduce((a, b) => a + b, 0)}`);

  // Манифест отдельным файлом — им сверяем счётчики после тестов.
  fs.writeFileSync(
    path.join(outDir, 'latest-manifest.json'),
    JSON.stringify({ startedAt, manifest }, null, 2),
    'utf8',
  );
}

main()
  .catch((e) => {
    console.error('ОШИБКА БЭКАПА:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
