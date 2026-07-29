/**
 * Автоматические скриншоты всех страниц/секций лендинга GrantChina.
 *
 * Для каждой страницы / секции делает 2 снимка:
 *   - viewport (1920x1080) → screenshots-landing/<name>__viewport.png
 *   - full page (1920 × вся высота) → screenshots-landing/<name>__fullpage.png
 *
 * Запуск (с production-лендинга):
 *   npm install
 *   npm run landing
 *
 * Запуск (с локального dev-лендинга на http://localhost:5173):
 *   npm run landing:local
 *
 * Если нужно сделать снимок кабинета студента (требует логин), задай
 * env-переменные:
 *   STUDENT_EMAIL=test@example.com STUDENT_PASSWORD=xxxxxxxx npm run landing
 * Без них кабинет пропускается.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const LANDING_URL = process.env.LANDING_URL || 'https://grantchina.tj';
const STUDENT_EMAIL = process.env.STUDENT_EMAIL || '';
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD || '';

const OUT_DIR = path.join(__dirname, 'screenshots-landing');
const VIEWPORT = { width: 1920, height: 1080 };

// Дополнительная задержка после goto для завершения анимаций framer-motion,
// загрузки шрифтов и lazy-картинок.
const SETTLE_MS = 2500;

// Главная — single-page, у неё много секций со своими якорями.
// Делаем full-page для всей страницы + viewport-снимки каждой секции.
const HOME_SECTIONS = [
  { name: '01-hero', selector: '.hero' },
  { name: '02-services', selector: '#services' },
  { name: '03-directions', selector: '#directions' },
  { name: '04-advantages', selector: '#advantages' },
  { name: '05-testimonials', selector: '#testimonials' },
  { name: '06-contacts', selector: '#contacts' },
  { name: '07-apply-form', selector: '#apply' },
];

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function settle(page, extraMs = 0) {
  // Ждём что сеть успокоится, шрифты загрузились, анимации завершились.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(SETTLE_MS + extraMs);
}

async function shoot(page, name) {
  // viewport-снимок (то что в окне 1920x1080)
  const viewportPath = path.join(OUT_DIR, `${name}__viewport.png`);
  await page.screenshot({ path: viewportPath, fullPage: false });
  console.log(`  ✅ ${name}__viewport.png`);

  // full-page снимок (вся страница, ширина 1920)
  const fullPath = path.join(OUT_DIR, `${name}__fullpage.png`);
  await page.screenshot({ path: fullPath, fullPage: true });
  console.log(`  ✅ ${name}__fullpage.png`);
}

async function shootHome(page) {
  console.log('\n📸 Главная (/) — full page + по секциям');
  await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded' });
  await settle(page);

  // Полная страница целиком
  await shoot(page, '00-home');

  // Каждая секция отдельно — скроллим к ней и снимаем viewport
  for (const section of HOME_SECTIONS) {
    try {
      const handle = await page.$(section.selector);
      if (!handle) {
        console.log(`  ⚠️  Секция не найдена: ${section.selector} (${section.name})`);
        continue;
      }
      await handle.scrollIntoViewIfNeeded();
      // Чуть подождать чтобы scroll-анимации framer-motion отыграли
      await page.waitForTimeout(800);
      const viewportPath = path.join(OUT_DIR, `${section.name}__viewport.png`);
      await page.screenshot({ path: viewportPath, fullPage: false });
      console.log(`  ✅ ${section.name}__viewport.png`);
    } catch (e) {
      console.log(`  ❌ ${section.name}: ${e.message}`);
    }
  }
}

async function shootLogin(page) {
  console.log('\n📸 Вход студента (/login)');
  try {
    // Сначала идём на главную чтобы SPA-router инициализировался,
    // потом навигируем на /login через клик — это надёжнее чем прямой
    // goto на /login, который ловит таймаут из-за PWA-service-worker.
    await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    // Пытаемся найти ссылку «Вход» и кликнуть; если нет — fallback на прямой goto
    const loginLink = await page.$('a[href="/login"], a[href*="/login"]');
    if (loginLink) {
      await Promise.all([
        page.waitForURL(/\/login/, { timeout: 30000 }).catch(() => {}),
        loginLink.click(),
      ]);
    } else {
      await page.goto(`${LANDING_URL}/login`, { waitUntil: 'load', timeout: 60000 });
    }
    await settle(page);
    await shoot(page, '10-student-login');
  } catch (e) {
    console.log(`  ❌ Не удалось снять /login: ${e.message}`);
  }
}

async function shootCabinet(page) {
  if (!STUDENT_EMAIL || !STUDENT_PASSWORD) {
    console.log('\n⏭️  Кабинет студента пропускается (STUDENT_EMAIL / STUDENT_PASSWORD не заданы)');
    return;
  }
  console.log('\n📸 Кабинет студента (/cabinet) — вход → снимки');
  await page.goto(`${LANDING_URL}/login`, { waitUntil: 'domcontentloaded' });
  await settle(page);

  // Логинимся
  try {
    await page.fill('input[type="email"]', STUDENT_EMAIL);
    await page.fill('input[type="password"]', STUDENT_PASSWORD);
    await Promise.all([
      page.waitForURL(/\/cabinet/, { timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
  } catch (e) {
    console.log(`  ❌ Не удалось войти: ${e.message}`);
    return;
  }
  await settle(page, 1500);
  await shoot(page, '11-student-cabinet');
}

(async () => {
  console.log(`🌐 Целевой URL: ${LANDING_URL}`);
  console.log(`📐 Viewport:    ${VIEWPORT.width}x${VIEWPORT.height}`);
  await ensureDir(OUT_DIR);
  console.log(`📁 Куда:        ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'ru-RU',
    // Эмулируем обычный десктоп
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Каждая функция обёрнута в try/catch внутри — если /login упадёт,
  // /cabinet всё равно попытается. Не прерываем весь цикл из-за одной ошибки.
  await shootHome(page).catch((e) => console.error('❌ Home:', e.message));
  await shootLogin(page).catch((e) => console.error('❌ Login:', e.message));
  await shootCabinet(page).catch((e) => console.error('❌ Cabinet:', e.message));

  console.log('\n✅ Готово. Все скриншоты в:');
  console.log(`   ${OUT_DIR}`);
  await browser.close();
})();
