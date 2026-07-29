import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { FileResolverService } from './file-resolver.service';
import { UploadsAccessService } from './uploads-access.service';
import { SessionResolverService } from '../auth/session-resolver.service';

@Module({
  imports: [
    // Свой JwtModule (как в realtime.module.ts) — SessionResolverService
    // верифицирует токены с явным secret на каждый вызов (staff/student),
    // модульный default используется только как заглушка конфигурации.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [UploadsController],
  providers: [FileResolverService, UploadsAccessService, SessionResolverService],
  // FileResolverService нужен ProgramsModule — сбрасывать TTL-кэш публичных
  // имён при create/update/remove программы.
  exports: [FileResolverService],
})
export class FilesModule {}
