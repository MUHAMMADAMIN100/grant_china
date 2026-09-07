import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { FileResolverService } from './file-resolver.service';
import { UploadsAccessService } from './uploads-access.service';
import { SessionResolverService } from '../auth/session-resolver.service';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';

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
  controllers: [UploadsController, StorageController],
  providers: [FileResolverService, UploadsAccessService, SessionResolverService, StorageService],
  // FileResolverService нужен ProgramsModule — сбрасывать TTL-кэш публичных
  // имён при create/update/remove программы.
  // StorageService — наружу ради StorageCheckJob (scheduler): один код пробы записи и для плитки, и для предупреждения.
  exports: [FileResolverService, StorageService],
})
export class FilesModule {}
