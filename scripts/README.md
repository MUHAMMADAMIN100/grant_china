# GrantChina — скрипты автоматических скриншотов

Папка с автономными скриптами для снятия скриншотов сайта проекта.
Не связана с production-кодом (backend/frontend-crm/frontend-landing) —
своё `package.json`, свои зависимости.

## Требования

- Node.js 18+ (у тебя уже стоит — на нём работает CRM/Landing)
- Доступ в интернет (Playwright скачает Chromium ~150 МБ при первой установке)

## Установка (один раз)

```bash
cd scripts
npm install
```

Команда установит Playwright и скачает headless Chromium.

## Запуск — скриншоты лендинга

### Production-лендинг (по умолчанию `https://grantchina.tj`)

```bash
npm run landing
```

### Локальный dev-лендинг (`http://localhost:5173`)

```bash
npm run landing:local
```

Сначала запусти dev-сервер лендинга (`cd ../frontend-landing && npm run dev`).

### С кабинетом студента (нужны учётные данные)

```bash
STUDENT_EMAIL=test@example.com STUDENT_PASSWORD=мойпароль npm run landing
```

На Windows PowerShell:

```powershell
$env:STUDENT_EMAIL="test@example.com"; $env:STUDENT_PASSWORD="мойпароль"; npm run landing
```

На Windows CMD:

```cmd
set STUDENT_EMAIL=test@example.com&& set STUDENT_PASSWORD=мойпароль&& npm run landing
```

Без этих переменных кабинет пропускается.

## Что получается

Папка `scripts/screenshots-landing/`. Для каждой страницы создаётся 2 файла:

- `<name>__viewport.png` — то что видно в окне 1920×1080
- `<name>__fullpage.png` — вся страница со скроллом, ширина 1920

### Список снимков

| Файл | Что |
|---|---|
| `00-home__viewport.png` | Главная — первый экран (Hero + статистика) |
| `00-home__fullpage.png` | Главная — вся страница со всеми секциями |
| `01-hero__viewport.png` | Секция Hero крупно |
| `02-services__viewport.png` | Секция «Программы» |
| `03-directions__viewport.png` | Секция «Направления» |
| `04-advantages__viewport.png` | Секция «Преимущества» |
| `05-testimonials__viewport.png` | Секция «Отзывы» (карусель) |
| `06-contacts__viewport.png` | Секция «Контакты» |
| `07-apply-form__viewport.png` | Форма «Оставить заявку» |
| `10-student-login__*.png` | Страница входа студента |
| `11-student-cabinet__*.png` | Кабинет студента (если задан логин) |

## Параметры (env)

| Переменная | Дефолт | Назначение |
|---|---|---|
| `LANDING_URL` | `https://grantchina.tj` | Базовый URL лендинга |
| `STUDENT_EMAIL` | (пусто) | Email тестового студента — для кабинета |
| `STUDENT_PASSWORD` | (пусто) | Пароль тестового студента — для кабинета |

## Тонкие настройки

В файле `screenshots-landing.js`:

- `VIEWPORT` — `{ width: 1920, height: 1080 }`. Меняй если нужен другой размер.
- `SETTLE_MS` — дополнительное время после загрузки страницы (для framer-motion-анимаций). По умолчанию 2500 мс. Если страница медленно отдаёт картинки — увеличь.
- `HOME_SECTIONS` — список секций главной с их CSS-селекторами. Можно убрать ненужные.

## .gitignore

В папке `scripts/screenshots-landing/` сохраняется до ~30 МБ PNG. Эти файлы НЕ нужно коммитить в git — они должны генерироваться по запросу. См. `.gitignore` в корне репо.
