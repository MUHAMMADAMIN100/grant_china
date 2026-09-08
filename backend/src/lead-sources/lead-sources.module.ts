import { Global, Module } from '@nestjs/common';
import { LeadSourcesController } from './lead-sources.controller';
import { LeadSourcesService } from './lead-sources.service';

// Глобальный: assertUsable() нужен ApplicationsService, ConsultationsService и
// StudentsService — трём модулям, которые пишут source. PrismaService и
// ActivityService — тоже глобальные, импортов не требуется.
@Global()
@Module({
  controllers: [LeadSourcesController],
  providers: [LeadSourcesService],
  exports: [LeadSourcesService],
})
export class LeadSourcesModule {}
