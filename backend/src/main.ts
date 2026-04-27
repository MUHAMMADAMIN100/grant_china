import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const corsOrigins = (config.get<string>('CORS_ORIGINS') || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Всегда разрешаем основные домены проекта (даже если их забыли в env).
  // Wildcard *.grantchina.tj и *.vercel.app поддерживаются ниже.
  const ALWAYS_ALLOWED_HOSTS = [
    'grantchina.tj',
    'www.grantchina.tj',
    'grant-china-crm.vercel.app',
    'grant-china-landing.vercel.app',
    'localhost:5173',
    'localhost:5174',
  ];

  const checkOrigin = (origin: string | undefined, cb: (err: any, ok?: boolean) => void) => {
    if (!origin) return cb(null, true); // запросы без Origin (curl, server-to-server)
    try {
      const url = new URL(origin);
      const host = url.host;
      // Точные совпадения из env
      if (corsOrigins.some((o) => o === origin || o === `${url.protocol}//${host}` || o === host)) {
        return cb(null, true);
      }
      // Хардкод: основные домены проекта
      if (ALWAYS_ALLOWED_HOSTS.includes(host)) return cb(null, true);
      // Wildcard *.grantchina.tj и *.vercel.app
      if (host.endsWith('.grantchina.tj') || host.endsWith('.vercel.app')) {
        return cb(null, true);
      }
      // Если CORS_ORIGINS не задан — разрешаем всё (как раньше)
      if (corsOrigins.length === 0) return cb(null, true);
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
}
bootstrap();
