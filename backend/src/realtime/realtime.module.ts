import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { SessionResolverService } from '../auth/session-resolver.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  // SessionResolverService нужен гейтвею, чтобы сверять роль/deletedAt с БД
  // при подключении сокета (Проблема A аудита) — переиспользует тот же
  // TTL-кэш, что jwt.strategy.ts/student-jwt.guard.ts используют в HTTP.
  providers: [RealtimeGateway, SessionResolverService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
