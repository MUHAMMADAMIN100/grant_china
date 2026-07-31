import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';

import { CsrfGuard } from './common/csrf.guard';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ApplicationsModule } from './applications/applications.module';
import { StudentsModule } from './students/students.module';
import { FilesModule } from './files/files.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TelegramModule } from './telegram/telegram.module';
import { MailModule } from './mail/mail.module';
import { SmsModule } from './sms/sms.module';
import { TasksModule } from './tasks/tasks.module';
import { StudentAuthModule } from './student-auth/student-auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ProgramsModule } from './programs/programs.module';
import { ActivityModule } from './activity/activity.module';
import { PaymentsModule } from './payments/payments.module';
import { ConsultationsModule } from './consultations/consultations.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { GrantsModule } from './grants/grants.module';
import { CommentsModule } from './comments/comments.module';
import { CallsModule } from './calls/calls.module';
import { ContractsModule } from './contracts/contracts.module';
import { PayrollModule } from './payroll/payroll.module';
// Волна 8: раздел «Билеты», база знаний + AI-помощник (ТЗ 6.1),
// единое окно диалогов (ТЗ 6.4).
import { TicketsModule } from './tickets/tickets.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AiModule } from './ai/ai.module';
import { MessagingModule } from './messaging/messaging.module';

// Проблема E аудита: ServeStaticModule отдавал ВЕСЬ каталог /uploads (сканы
// паспортов, BANK/MEDICAL справки, фото студентов) анониму без всякой
// авторизации. Раздачу файлов с проверкой прав теперь делает FilesModule →
// UploadsController (@Controller('uploads'), см. files/uploads.controller.ts);
// main.ts:setGlobalPrefix() исключает 'uploads/*' из префикса /api, чтобы
// URL-контракт /uploads/<name> остался прежним для уже сохранённых в БД ссылок.
//
// UPLOADS_PROTECTED — аварийный откат на случай, если защита в проде ведёт
// себя не так, как ожидалось (например каталог на Railway volume смонтирован
// иначе, чем локально). По умолчанию (ЛЮБОЕ значение, кроме '0') — защита
// ВКЛЮЧЕНА. Явно выставить UPLOADS_PROTECTED=0 в Railway env — вернёт старое
// поведение (ServeStaticModule, весь каталог отдаётся анониму без проверок)
// БЕЗ передеплоя кода. Держать этот флаг выключенным дольше нескольких минут
// небезопасно — используется только чтобы откатиться, если что-то пошло не
// так, пока чинится настоящая причина.
const UPLOADS_PROTECTED = process.env.UPLOADS_PROTECTED !== '0';

// Проблема 5 аудита волны 1: раньше значение читалось молча — забытая после
// инцидента переменная в Railway env тихо убивала защиту НАВСЕГДА, без
// единого следа в логах. Теперь при каждом старте явно кричим в лог уровнем
// error, если kill-switch активирован — чтобы это было видно в Railway logs
// сразу, а не найдено случайно через полгода при пентесте.
if (!UPLOADS_PROTECTED) {
  new Logger('AppModule').error(
    'ВНИМАНИЕ: UPLOADS_PROTECTED=0 — каталог /uploads отдаётся БЕЗ АВТОРИЗАЦИИ. ' +
      'Документы студентов (паспорта, банковские и медицинские справки) доступны любому. ' +
      'Это аварийный откат — держать его дольше нескольких минут небезопасно.',
  );
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...(UPLOADS_PROTECTED
      ? []
      : [
          ServeStaticModule.forRoot({
            rootPath: join(process.cwd(), process.env.UPLOADS_DIR || './uploads'),
            serveRoot: '/uploads',
          }),
        ]),
    // Глобальные rate-limits. Точечные более жёсткие лимиты — через @Throttle()
    // на конкретных публичных эндпоинтах (POST /applications/public,
    // POST /student-auth/login).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    ApplicationsModule,
    StudentsModule,
    FilesModule,
    NotificationsModule,
    TelegramModule,
    MailModule,
    SmsModule,
    TasksModule,
    StudentAuthModule,
    RealtimeModule,
    ProgramsModule,
    ActivityModule,
    PaymentsModule,
    ConsultationsModule,
    SchedulerModule,
    GrantsModule,
    CommentsModule,
    CallsModule,
    ContractsModule,
    PayrollModule,
    TicketsModule,
    KnowledgeModule,
    AiModule,
    MessagingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // CsrfGuard идёт ПОСЛЕ ThrottlerGuard: сначала режем флуд, потом
    // разбираемся с межсайтовыми запросами. Проверяет только мутирующие
    // методы и намеренно пропускает запросы без Origin/Sec-Fetch-Site —
    // иначе лёг бы прод, где Vercel проксирует сервер-к-серверу.
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
