import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';

// PrismaService — глобальный модуль. KnowledgeModule импортируется явно:
// AiService собирает контекст помощника через KnowledgeService.buildContext(),
// а не читает prisma.knowledgeArticle напрямую — граница модуля одна
// (тот же принцип, что ConsultationsModule → TasksService).
@Module({
  imports: [KnowledgeModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
