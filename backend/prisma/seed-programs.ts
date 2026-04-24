import { PrismaClient, Direction } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

type SeedProgram = {
  name: string;
  university: string;
  city: string;
  major: string;
  direction: Direction;
  cost: number;
  currency: string;
  duration: string;
  language: string;
  description: string;
  imageFile?: string;
};

const PROGRAMS: SeedProgram[] = [
  {
    name: 'Программа колледжа — Уси (ID 202620208)',
    university: 'Колледж в городе Уси (Wuxi)',
    city: 'Уси (Wuxi)',
    major: 'Программная инженерия, E-commerce, ИИ, IoT и др.',
    direction: Direction.BACHELOR,
    cost: 5300,
    currency: 'CNY',
    duration: '1 + 3 года',
    language: 'Китайский',
    description:
      '📍 Локация: Wuxi, провинция Jiangsu Province, China\n' +
      'ID программы: 202620208\n' +
      '📅 Дедлайн подачи: 30 июня 2026\n' +
      '⏳ Продолжительность: 1 + 3 года (1 год языковая подготовка + 3 года колледж)\n\n' +
      '💰 Стоимость обучения:\n' +
      '• Подготовительный языковой год — ¥5700 / год\n' +
      '• Основное обучение (колледж) — ¥4700 / ¥5300 / ¥6800 в год\n\n' +
      '🏠 Проживание (общежитие):\n' +
      '• 4-местная комната — ¥2400 / год\n' +
      '• 6-местная комната — ¥1200 / год\n\n' +
      '📌 Требования:\n' +
      '• Возраст: 18–24 года (обязательно 18+)\n' +
      '• Переход на 2-й год — с HSK4\n\n' +
      '📚 Специальности (обучение на китайском):\n' +
      '• Программная инженерия\n' +
      '• Электронная коммерция\n' +
      '• Международная e-commerce (трансграничная торговля)\n' +
      '• Интеллектуальная логистика\n' +
      '• Применение технологий искусственного интеллекта\n' +
      '• Технологии интернета вещей\n' +
      '• Диагностика и ремонт автомобилей\n' +
      '• Электронная информационная инженерия\n' +
      '• Электроавтоматизация\n' +
      '• Интеллектуальное строительство',
    imageFile: '1',
  },
  {
    name: 'Программа колледжа — Тунжэнь (ID 202621708)',
    university: 'Колледж в городе Тунжэнь (Tongren)',
    city: 'Тунжэнь (Tongren)',
    major: 'Компьютерные науки, медицина, ИИ, туризм и др.',
    direction: Direction.BACHELOR,
    cost: 4000,
    currency: 'CNY',
    duration: '1 + 3 года',
    language: 'Китайский',
    description:
      '📍 Локация: Tongren, провинция Guizhou Province, China\n' +
      'ID программы: 202621708\n' +
      '📅 Дедлайн подачи: 1 июля 2026\n' +
      '⏳ Продолжительность: 1 + 3 года (1 год языковая подготовка + 3 года колледж)\n\n' +
      '💰 Стоимость обучения:\n' +
      '• Подготовительный языковой год — ¥3500 / год\n' +
      '• Основное обучение (колледж) — ¥4000 / год\n\n' +
      '🏠 Проживание (общежитие):\n' +
      '• 4-местная комната — ¥1200 / год с человека\n' +
      '• 2-местная комната — ¥2500 / год с человека\n\n' +
      '📌 Требования:\n' +
      '• Возраст: 16–35 лет\n' +
      '• Переход на 2-й год — с HSK3\n\n' +
      '📚 Специальности (обучение на китайском):\n' +
      '• Компьютерные науки и технологии\n' +
      '• Электронная коммерция\n' +
      '• Туризм и гостиничный менеджмент\n' +
      '• Применение технологий искусственного интеллекта\n' +
      '• Фармацевтика\n' +
      '• Традиционная медицина\n' +
      '• Уход и управление здоровьем пожилых\n' +
      '• Клиническая медицина\n' +
      '• Реабилитационная терапия\n' +
      '• Животноводство и ветеринария',
    imageFile: '2',
  },
  {
    name: 'Программа колледжа — Цзуньи (ID 202638308)',
    university: 'Колледж в городе Цзуньи (Zunyi)',
    city: 'Цзуньи (Zunyi)',
    major: 'Мехатроника, новая энергетика, дизайн, садоводство',
    direction: Direction.BACHELOR,
    cost: 8000,
    currency: 'CNY',
    duration: '1 + 3 года',
    language: 'Китайский',
    description:
      '📍 Локация: Zunyi, провинция Guizhou Province, China\n' +
      'ID программы: 202638308\n' +
      '📅 Дедлайн подачи: 30 мая 2026\n' +
      '⏳ Продолжительность: 1 + 3 года (1 год языковая подготовка + 3 года колледж)\n\n' +
      '💰 Стоимость обучения:\n' +
      '• Подготовительный языковой год — ¥6000 / год\n' +
      '• Основное обучение (колледж) — ¥8000 / год\n\n' +
      '🎓 Стипендии:\n' +
      'Языковая программа:\n' +
      '• 100% покрытие обучения\n' +
      '• 75% покрытие обучения\n' +
      'Профессиональная программа:\n' +
      '• 100% покрытие обучения\n' +
      '• 75% покрытие обучения\n\n' +
      '🏠 Проживание (общежитие):\n' +
      '• 4-местная комната — ¥1500 / год с человека\n\n' +
      '📌 Требования:\n' +
      '• Возраст: 18–25 лет\n' +
      '• Переход на 2-й год — с HSK3+\n\n' +
      '📚 Специальности (обучение на китайском):\n' +
      '• Мехатроника\n' +
      '• Технологии новой энергетики\n' +
      '• Дизайн интерьера\n' +
      '• Садоводство\n' +
      '• Животноводство и ветеринария',
    imageFile: '3',
  },
  {
    name: 'Программа колледжа — Циндао (ID 202638808)',
    university: 'Колледж в городе Циндао (Qingdao)',
    city: 'Циндао (Qingdao)',
    major: 'IT, e-commerce, дизайн, китайский язык',
    direction: Direction.BACHELOR,
    cost: 8000,
    currency: 'CNY',
    duration: '1 + 3 года',
    language: 'Китайский',
    description:
      '📍 Локация: Qingdao, провинция Shandong Province, China\n' +
      'ID программы: 202638808\n' +
      '📅 Дедлайн подачи: 1 июня 2026\n' +
      '⏳ Продолжительность: 1 + 3 года (1 год языковая подготовка + 3 года колледж)\n\n' +
      '💰 Стоимость обучения:\n' +
      '• Подготовительный языковой год — ¥7000 / год\n' +
      '• Основное обучение (колледж) — ¥8000 / год\n\n' +
      '🎓 Стипендии:\n' +
      '• Языковая программа — ¥5000\n' +
      'Профессиональная программа:\n' +
      '• ¥8000 / год\n' +
      '• ¥6000 / год\n' +
      '• ¥4000 / год\n' +
      '❗ Стипендии не уменьшают стоимость обучения\n\n' +
      '🏠 Проживание (общежитие):\n' +
      '• 2-местная комната — ¥2000 / год с человека\n\n' +
      '📌 Требования:\n' +
      '• Возраст: 17–35 лет\n' +
      '• Переход на 2-й год — с HSK3\n\n' +
      '📚 Специальности (обучение на китайском):\n' +
      '• Программная инженерия\n' +
      '• Международная электронная коммерция\n' +
      '• Дизайн ювелирных изделий и промышленный дизайн\n' +
      '• Китайский язык',
    imageFile: '4',
  },
  {
    name: 'Программа колледжа — Нанкин (ID 202639508)',
    university: 'Колледж в городе Нанкин (Nanjing)',
    city: 'Нанкин (Nanjing)',
    major: 'Финансы, туризм, медиа-дизайн, логистика и др.',
    direction: Direction.BACHELOR,
    cost: 6000,
    currency: 'CNY',
    duration: '1 + 2 года',
    language: 'Китайский',
    description:
      '📍 Локация: Nanjing, провинция Jiangsu Province, China\n' +
      'ID программы: 202639508\n' +
      '📅 Дедлайн подачи: 30 июня 2026\n' +
      '⏳ Продолжительность: 1 + 2 года (1 год языковая подготовка + 2 года колледж)\n\n' +
      '💰 Стоимость обучения:\n' +
      '• Обучение — ¥6000 / год\n\n' +
      '🏠 Проживание (общежитие):\n' +
      '• 6-местная комната — ¥1200 / год\n\n' +
      '📌 Требования:\n' +
      '• Возраст: от 16 лет\n\n' +
      '📚 Специальности (обучение на китайском):\n' +
      '• Международные финансы\n' +
      '• Туризм и гостиничный менеджмент\n' +
      '• Цифровой медиа-дизайн\n' +
      '• Электронная коммерция\n' +
      '• Современная логистика\n' +
      '• Международная экономика и торговля\n' +
      '• Холодильные и климатические технологии\n' +
      '• Контроль и безопасность пищевой продукции\n' +
      '• Управление сетевым бизнесом',
    imageFile: '5',
  },
];

// Папка, куда пользователь может положить картинки 1.jpg..5.jpg (или .png/.webp)
const IMAGES_SRC = path.join(__dirname, 'seed-programs-images');
const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

function findImageFile(key: string): string | null {
  if (!fs.existsSync(IMAGES_SRC)) return null;
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of exts) {
    const p = path.join(IMAGES_SRC, `${key}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function detectExt(srcPath: string): string {
  const fd = fs.openSync(srcPath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return '.webp';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
  return path.extname(srcPath).toLowerCase() || '.bin';
}

function copyToUploads(srcPath: string): string {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const ext = detectExt(srcPath);
  const dstName = `${randomUUID()}${ext}`;
  const dstPath = path.join(UPLOADS_DIR, dstName);
  fs.copyFileSync(srcPath, dstPath);
  return `/uploads/${dstName}`;
}

async function main() {
  console.log('🌱 Seeding programs...');

  for (const p of PROGRAMS) {
    const existing = await prisma.program.findFirst({ where: { name: p.name } });

    let imageUrl: string | null = null;
    if (p.imageFile) {
      const src = findImageFile(p.imageFile);
      if (src) {
        imageUrl = copyToUploads(src);
        console.log(`  🖼  Картинка для «${p.name}» → ${imageUrl}`);
      } else {
        console.log(`  (нет картинки ${p.imageFile}.jpg/png/webp в ${IMAGES_SRC})`);
      }
    }

    if (existing) {
      await prisma.program.update({
        where: { id: existing.id },
        data: {
          university: p.university,
          city: p.city,
          major: p.major,
          direction: p.direction,
          cost: p.cost,
          currency: p.currency,
          duration: p.duration,
          language: p.language,
          description: p.description,
          ...(imageUrl ? { imageUrl } : {}),
          published: true,
        },
      });
      console.log(`  ✏️  Обновлено: ${p.name}`);
    } else {
      await prisma.program.create({
        data: {
          name: p.name,
          university: p.university,
          city: p.city,
          major: p.major,
          direction: p.direction,
          cost: p.cost,
          currency: p.currency,
          duration: p.duration,
          language: p.language,
          description: p.description,
          imageUrl: imageUrl || null,
          published: true,
        },
      });
      console.log(`  ➕ Создано:   ${p.name}`);
    }
  }

  console.log('✅ Программы загружены.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
