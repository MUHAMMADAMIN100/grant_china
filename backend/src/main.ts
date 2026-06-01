import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Railway/Vercel/любой reverse proxy терминирует TLS у себя и отправляет
  // запрос дальше по plain HTTP с заголовком X-Forwarded-Proto=https.
  // Без trust proxy Express считает запрос insecure, и cookie с Secure=true
  // браузер бы отверг. Доверяем ровно одному hop (Railway edge).
  const expressInstance = app.getHttpAdapter().getInstance();
  if (expressInstance?.set) {
    expressInstance.set('trust proxy', 1);
  }

  // Парсим cookies — нужно чтобы JwtStrategy могла читать httpOnly JWT
  // из cookie `gc_token` (новый способ авторизации вместо localStorage).
  app.use(cookieParser());

  // === HTTP security headers (Helmet) ===
  // - HSTS: форсируем HTTPS на 6 месяцев + preload
  // - X-Content-Type-Options: nosniff
  // - X-Frame-Options: SAMEORIGIN (защита от clickjacking)
  // - Referrer-Policy: no-referrer
  // - X-DNS-Prefetch-Control, X-Download-Options, X-Permitted-Cross-Domain-Policies
  // - Cross-Origin-Resource-Policy: same-origin (но для /uploads/ ниже мягче)
  //
  // CSP мы отключаем глобально: backend отдаёт API (JSON) + статику /uploads
  // (юзер-загруженные файлы). CSP — забота фронтенда (Vercel). Если включить
  // здесь, поломает PWA лендинга и embed-картинки CRM.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // /uploads нужен фронту
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 60 * 60 * 24 * 180, // 180 дней
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'sameorigin' },
    }),
  );

  // === CORS ===
  // Строже чем раньше:
  //  - Если CORS_ORIGINS не задан — НЕ разрешаем всё (раньше было `return true`).
  //    Теперь оставляем только хардкод-список основных доменов проекта.
  //  - Для запросов БЕЗ Origin (curl, server-to-server) — пропускаем (это не
  //    браузер, CSRF/cookie-attack не применим).
  //  - Wildcard `*.vercel.app` оставлен (нужен для preview-деплоев Vercel).
  const corsOrigins = (config.get<string>('CORS_ORIGINS') || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const ALWAYS_ALLOWED_HOSTS = [
    'grantchina.tj',
    'www.grantchina.tj',
    'grant-china-crm.vercel.app',
    'grant-china-landing.vercel.app',
    'localhost:5173',
    'localhost:5174',
  ];

  const checkOrigin = (origin: string | undefined, cb: (err: any, ok?: boolean) => void) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    try {
      const url = new URL(origin);
      const host = url.host;
      if (corsOrigins.some((o) => o === origin || o === `${url.protocol}//${host}` || o === host)) {
        return cb(null, true);
      }
      if (ALWAYS_ALLOWED_HOSTS.includes(host)) return cb(null, true);
      if (host.endsWith('.grantchina.tj') || host.endsWith('.vercel.app')) {
        return cb(null, true);
      }
      // Чужой Origin — блокируем безусловно. Никакого «если env пуст —
      // разрешаем всё», это была дыра.
      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    } catch {
      return cb(new Error('Bad Origin'), false);
    }
  };

  app.enableCors({
    origin: checkOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.setGlobalPrefix('api');

  const port = parseInt(config.get<string>('PORT') || '3001', 10);
  await app.listen(port);
  console.log(`🚀 GrantChina API: http://localhost:${port}/api`);

  // Логируем egress (исходящий) IP при старте — нужен чтобы добавить
  // его в IP-whitelist у внешних провайдеров (Payom.tj, и т.п.) которые
  // требуют whitelist для API. Railway меняет IP при редеплое — после
  // каждого старта смотри в логах актуальное значение.
  fetch('https://api.ipify.org')
    .then((r) => r.text())
    .then((ip) => console.log(`🌐 OUTBOUND_IP: ${ip}  (добавь в Payom whitelist если SMS падают с 403)`))
    .catch((e) => console.log(`🌐 OUTBOUND_IP: не удалось определить (${(e as Error).message})`));
}
bootstrap();
