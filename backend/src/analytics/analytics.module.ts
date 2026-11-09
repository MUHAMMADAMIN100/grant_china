import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { SalesAnalyticsController } from './sales-analytics.controller';
import { SalesAnalyticsService } from './sales-analytics.service';

@Module({
  imports: [ApplicationsModule],
  providers: [SalesAnalyticsService],
  controllers: [SalesAnalyticsController],
})
export class AnalyticsModule {}
