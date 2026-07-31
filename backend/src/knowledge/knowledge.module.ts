import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

// PrismaService/ActivityService — глобальные модули, импортировать не нужно.
// KnowledgeService экспортируется: AiModule собирает через него контекст для
// помощника (buildContext) — прямого доступа к prisma.knowledgeArticle из
// ai.service.ts нет намеренно, граница модуля одна.
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
