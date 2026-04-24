import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    await this.migrateLegacyStatuses();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Одноразовая миграция старых статусов заявок на новую 6-шаговую модель */
  private async migrateLegacyStatuses() {
    try {
      const inProgress = await this.application.updateMany({
        where: { status: 'IN_PROGRESS' as any },
        data: { status: 'DOCS_REVIEW' as any },
      });
      const completed = await this.application.updateMany({
        where: { status: 'COMPLETED' as any },
        data: { status: 'ENROLLED' as any },
      });
      if (inProgress.count + completed.count > 0) {
        this.logger.log(
          `Migrated legacy statuses: IN_PROGRESS→DOCS_REVIEW=${inProgress.count}, COMPLETED→ENROLLED=${completed.count}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Status migration skipped: ${(err as Error).message}`);
    }
  }
}
