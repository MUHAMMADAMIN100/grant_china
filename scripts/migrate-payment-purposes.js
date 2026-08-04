/**
 * ТЗ v3 раздел 3 — перевод истории платежей на пять новых типов оплат.
 *
 * РЕШЕНИЕ ЗАКАЗЧИКА: переводить историю, а не оставлять старые названия.
 *
 * Что делает:
 *   Регистрация студента     -> Предоплата
 *   Зачисление в университет -> Оплата за регистрацию в университете
 *   После переезда           -> Оплата за обучение и проживание
 *   Проживание               -> Оплата за обучение и проживание
 *   Питание                  -> Оплата за обучение и проживание
 *   Документация             -> не меняется (название совпало)
 *   Консультация, Другое     -> НЕ ТРОГАЕМ (решение заказчика: среди пяти
 *                               новых пунктов соответствия нет, а сваливать
 *                               консультации в «Полную оплату» означало бы
 *                               завысить отчёт по полным оплатам)
 *
 * ЧЕГО СКРИПТ НЕ ДЕЛАЕТ НИКОГДА:
 *   - не удаляет ни одной строки (никаких delete/deleteMany)
 *   - не трогает суммы, даты, статусы, чеки и связи
 *   - не перезаписывает legacyPurpose, если он уже заполнен (повторный
 *     запуск не затрёт исходное значение вторым переводом)
 *
 * ОБРАТИМОСТЬ. Исходный тип сохраняется в Payment.legacyPurpose. Откат:
 *   UPDATE "Payment" SET purpose = "legacyPurpose", "legacyPurpose" = NULL
 *   WHERE "legacyPurpose" IS NOT NULL;
 *
 * ЗАПУСК:
 *   node scripts/migrate-payment-purposes.js          # только показать план
 *   node scripts/migrate-payment-purposes.js --apply  # выполнить
 *
 * Сверка сумм до и после — встроенная. Если общая сумма платежей изменилась
 * хотя бы на копейку, скрипт кричит об этом в конце.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

/** Соответствие старых типов новым. Ключей нет = тип не переводится. */
const MAPPING = {
  REGISTRATION: 'PREPAYMENT',
  ENROLLMENT: 'UNIVERSITY_REGISTRATION',
  RELOCATION: 'TUITION_ACCOMMODATION',
  ACCOMMODATION: 'TUITION_ACCOMMODATION',
  FOOD: 'TUITION_ACCOMMODATION',
};

const LABEL = {
  PREPAYMENT: 'Предоплата',
  UNIVERSITY_REGISTRATION: 'Оплата за регистрацию в университете',
  DOCUMENTATION: 'Документация',
  FULL_PAYMENT: 'Полная оплата',
  TUITION_ACCOMMODATION: 'Оплата за обучение и проживание',
  REGISTRATION: 'Регистрация студента',
  ENROLLMENT: 'Зачисление в университет',
  RELOCATION: 'После переезда',
  ACCOMMODATION: 'Проживание',
  FOOD: 'Питание',
  CONSULTATION: 'Консультация',
  OTHER: 'Другое',
};

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

async function snapshot() {
  const rows = await prisma.payment.groupBy({
    by: ['purpose'],
    _count: { _all: true },
    _sum: { amount: true },
  });
  const map = new Map();
  let totalCount = 0;
  let totalSum = 0;
  for (const r of rows) {
    const sum = Number(r._sum.amount || 0);
    map.set(r.purpose, { count: r._count._all, sum });
    totalCount += r._count._all;
    totalSum += sum;
  }
  return { map, totalCount, totalSum };
}

function printSnapshot(title, snap) {
  console.log(`--- ${title} ---`);
  for (const [purpose, v] of [...snap.map.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${(LABEL[purpose] || purpose).padEnd(38)} ${String(v.count).padStart(5)} шт   ${v.sum.toFixed(2).padStart(13)}`);
  }
  console.log(`  ${'ИТОГО'.padEnd(38)} ${String(snap.totalCount).padStart(5)} шт   ${snap.totalSum.toFixed(2).padStart(13)}`);
}

async function main() {
  const before = await snapshot();
  printSnapshot('ДО ПЕРЕВОДА', before);

  console.log('\n--- ПЛАН ---');
  const plan = [];
  for (const [from, to] of Object.entries(MAPPING)) {
    // Считаем только те, у которых legacyPurpose ещё не заполнен: повторный
    // запуск не должен переписать исходное значение поверх уже сохранённого.
    const count = await prisma.payment.count({ where: { purpose: from, legacyPurpose: null } });
    if (count === 0) continue;
    plan.push({ from, to, count });
    console.log(`  ${LABEL[from].padEnd(30)} -> ${LABEL[to].padEnd(38)} ${String(count).padStart(5)} шт`);
  }
  const untouched = ['DOCUMENTATION', 'CONSULTATION', 'OTHER'];
  for (const p of untouched) {
    const v = before.map.get(p);
    if (v) console.log(`  ${LABEL[p].padEnd(30)} -> не трогаем${' '.repeat(28)}${String(v.count).padStart(5)} шт`);
  }
  if (plan.length === 0) {
    console.log('  Переводить нечего — история уже в новых типах.');
  }

  if (!APPLY) {
    console.log('\nНичего не изменено. Для выполнения: node scripts/migrate-payment-purposes.js --apply');
    return;
  }

  console.log('\n--- ВЫПОЛНЕНИЕ ---');
  let touched = 0;
  for (const { from, to, count } of plan) {
    // updateMany, а не поштучно: одна операция на тип, атомарна на уровне
    // строки. legacyPurpose пишем ТОЛЬКО там, где он ещё пуст (условие в
    // where), поэтому повторный запуск ничего не испортит.
    const res = await prisma.payment.updateMany({
      where: { purpose: from, legacyPurpose: null },
      data: { purpose: to, legacyPurpose: from },
    });
    touched += res.count;
    console.log(`  ${LABEL[from]} -> ${LABEL[to]}: обновлено ${res.count} из ${count}`);
  }

  const after = await snapshot();
  console.log('');
  printSnapshot('ПОСЛЕ ПЕРЕВОДА', after);

  console.log('\n--- СВЕРКА ---');
  const countOk = before.totalCount === after.totalCount;
  const sumOk = Math.abs(before.totalSum - after.totalSum) < 0.005;
  console.log(`  строк:  было ${before.totalCount}, стало ${after.totalCount}  ${countOk ? 'СОВПАЛО' : '!!! РАСХОЖДЕНИЕ !!!'}`);
  console.log(`  сумма:  было ${before.totalSum.toFixed(2)}, стало ${after.totalSum.toFixed(2)}  ${sumOk ? 'СОВПАЛО' : '!!! РАСХОЖДЕНИЕ !!!'}`);
  const withLegacy = await prisma.payment.count({ where: { legacyPurpose: { not: null } } });
  console.log(`  сохранено исходных типов (legacyPurpose): ${withLegacy}`);
  console.log(`  переведено за этот запуск: ${touched}`);

  if (!countOk || !sumOk) {
    console.error('\nСВЕРКА НЕ СОШЛАСЬ. Откат: UPDATE "Payment" SET purpose = "legacyPurpose", "legacyPurpose" = NULL WHERE "legacyPurpose" IS NOT NULL;');
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error('ОШИБКА:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
