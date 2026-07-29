/**
 * Автоматические скриншоты всех страниц CRM проекта GrantChina.
 *
 * Цикл выполнения:
 *  1. Через Playwright логинится в CRM существующей учётной записью,
 *     переданной в env.
 *  2. Делает скриншоты ~16 страниц: viewport (1920×1080) + fullpage PNG.
 *
 * Скрипт НЕ ПОДКЛЮЧАЕТСЯ К БАЗЕ и ничего в ней не меняет.
 *
 * Раньше он создавал временного пользователя с ролью FOUNDER сырым
 * INSERT-ом и удалял его в finally. Это было плохо по трём причинам:
 *  - сырой SQL в обход всех проверок приложения;
 *  - `DELETE FROM "User"` в репозитории при жёстком правиле проекта
 *    «никогда не удалять данные из БД»;
 *  - если процесс убьют между INSERT и DELETE (Ctrl+C, падение, обрыв
 *    сети до Railway), в БОЕВОЙ базе навсегда остаётся живой аккаунт
 *    Основателя с паролем, который нигде не сохранён.
 * Теперь нужен просто существующий логин — скрипт читает только UI.
 *
 * Запуск:
 *   set CRM_URL=https://grantchina.tj/admin
 *   set CRM_EMAIL=ваш@email
 *   set CRM_PASSWORD=ваш_пароль
 *   npm run crm
 *
 * Учётка должна иметь роль Основателя — у Администратора часть кнопок
 * на /users скрыта, и скриншоты выйдут неполными.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CRM_URL = (process.env.CRM_URL || 'https://grantchina.tj/admin').replace(/\/$/, '');
const CRM_EMAIL = process.env.CRM_EMAIL;
const CRM_PASSWORD = process.env.CRM_PASSWORD;

if (!CRM_EMAIL || !CRM_PASSWORD) {
  console.error('❌ Нужны CRM_EMAIL и CRM_PASSWORD существующей учётной записи:');
  console.error('   set CRM_EMAIL=ваш@email');
  console.error('   set CRM_PASSWORD=ваш_пароль');
  console.error('');
  console.error('Скрипт намеренно не создаёт пользователей и не ходит в базу.');
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, 'screenshots-crm');
const VIEWPORT = { width: 1920, height: 1080 };
const SETTLE_MS = 2500;

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function settle(page, extraMs = 0) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(SETTLE_MS + extraMs);
}

async function shoot(page, name) {
  const viewportPath = path.join(OUT_DIR, `${name}__viewport.png`);
  await page.screenshot({ path: viewportPath, fullPage: false });
  console.log(`  ✅ ${name}__viewport.png`);

  const fullPath = path.join(OUT_DIR, `${name}__fullpage.png`);
  await page.screenshot({ path: fullPath, fullPage: true });
  console.log(`  ✅ ${name}__fullpage.png`);
}

async function login(page) {
  console.log(`\n🔐 Логин в CRM (${CRM_URL}/login)`);
  await page.goto(`${CRM_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);

  // Снимок страницы логина ДО ввода
  await shoot(page, '01-login');

  await page.fill('input[type="email"]', CRM_EMAIL);
  await page.fill('input[type="password"]', CRM_PASSWORD);
  await Promise.all([
    // Жёстко ждём именно /dashboard (не любой URL с /admin)
    page.waitForURL((url) => /\/dashboard($|\?|#)/.test(url.toString()), { timeout: 30000 })
      .catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await settle(page, 1500);

  // Проверяем что мы залогинены — должен появиться sidebar (auth-only элемент)
  const sidebar = await page.$('.sidebar, aside.sidebar');
  if (!sidebar) {
    const currentUrl = page.url();
    throw new Error(
      `Не удалось войти в CRM. Текущий URL: ${currentUrl}. Sidebar не найден — возможно frontend-валидация заблокировала submit.`,
    );
  }
  console.log(`✅ Вошли в CRM (текущий URL: ${page.url()})`);
}

async function shootStatic(page, name, urlPath) {
  console.log(`\n📸 ${name} (${urlPath})`);
  try {
    await page.goto(`${CRM_URL}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(page);
    await shoot(page, name);
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

/** Открывает первую заявку из списка и делает снимок её детальной страницы. */
async function shootFirstApplication(page) {
  console.log('\n📸 09-application-detail (детали первой заявки)');
  try {
    await page.goto(`${CRM_URL}/applications`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(page);
    // Кликаем на первую строку таблицы
    const firstRow = await page.$('table tbody tr');
    if (!firstRow) {
      console.log('  ⏭️  Нет заявок в системе — пропускаем детали');
      return;
    }
    await Promise.all([
      page.waitForURL(/\/applications\/[^/]+$/, { timeout: 15000 }).catch(() => {}),
      firstRow.click(),
    ]);
    await settle(page, 1500);
    await shoot(page, '09-application-detail');
  } catch (e) {
    console.log(`  ❌ application-detail: ${e.message}`);
  }
}

/** Открывает первого студента из списка и делает снимок его карточки. */
async function shootFirstStudent(page) {
  console.log('\n📸 12-student-detail (карточка первого студента)');
  try {
    await page.goto(`${CRM_URL}/students`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(page);
    const firstRow = await page.$('table tbody tr');
    if (!firstRow) {
      console.log('  ⏭️  Нет студентов в системе — пропускаем карточку');
      return;
    }
    await Promise.all([
      page.waitForURL(/\/students\/[^/]+$/, { timeout: 15000 }).catch(() => {}),
      firstRow.click(),
    ]);
    await settle(page, 1500);
    await shoot(page, '12-student-detail');
  } catch (e) {
    console.log(`  ❌ student-detail: ${e.message}`);
  }
}

(async () => {
  console.log(`🌐 CRM:       ${CRM_URL}`);
  console.log(`📐 Viewport:  ${VIEWPORT.width}x${VIEWPORT.height}`);
  await ensureDir(OUT_DIR);
  console.log(`📁 Куда:      ${OUT_DIR}`);

  console.log(`👤 Логин:     ${CRM_EMAIL}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'ru-RU',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await login(page);

    // Основные страницы CRM
    await shootStatic(page, '02-dashboard', '/dashboard');
    await shootStatic(page, '03-applications-list', '/applications');
    await shootFirstApplication(page);
    await shootStatic(page, '10-students-list', '/students');
    await shootFirstStudent(page);
    await shootStatic(page, '13-student-new', '/students/new');
    await shootStatic(page, '14-programs', '/programs');
    await shootStatic(page, '15-tasks', '/tasks');
    await shootStatic(page, '16-users', '/users');
    await shootStatic(page, '17-activity', '/activity');

    console.log('\n✅ Все скриншоты сняты.');
  } catch (e) {
    console.error('❌ Ошибка во время съёмки:', e.message);
  } finally {
    await browser.close().catch(() => {});
    console.log(`\n📁 Результаты:\n   ${OUT_DIR}`);
  }
})();
