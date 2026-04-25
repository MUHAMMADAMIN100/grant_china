import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), process.env.UPLOADS_DIR || './uploads'),
      serveRoot: '/uploads',
    }),
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
  ],
})
export class AppModule {}
