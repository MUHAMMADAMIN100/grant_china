import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { checkOrigin } from './common/cors';

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
  //  - Для запросов БЕЗ Origin (curl, server-to-server, Vercel rewrite) —
  //    пропускаем (это не браузер, CSRF/cookie-attack не применим).
  //  - Wildcard `*.vercel.app` УБРАН (Проблема 1 аудита волны 1) — в проде
  //    трафик идёт через Vercel rewrites сервер-к-серверу (Origin вообще не
  //    доходит до Railway), поэтому wildcard был нужен только теоретически,
  //    а на практике давал любому чужому *.vercel.app читать ответы API с
  //    cookie сотрудника (credentials: true + SameSite=None в проде).
  //  - checkOrigin вынесен в common/cors.ts — та же функция используется
  //    WebSocket-гейтвеем (realtime.gateway.ts), чтобы логика не расходилась.
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

  // 'uploads/*' исключён из /api — FilesModule (files/uploads.controller.ts)
  // обслуживает @Controller('uploads') на корне, а не /api/uploads: этот
  // путь уже "зашит" в БД (Document.url, Program.imageUrl, Student.photoUrl
  // хранят '/uploads/<name>') и в rewrite-правилах фронтов (frontend-crm/
  // vercel.json, frontend-landing/vercel.json, Telegram PUBLIC_API_BASE).
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'uploads/(.*)', method: RequestMethod.ALL }],
  });

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
