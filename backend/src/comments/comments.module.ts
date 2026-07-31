import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

// PrismaService/ActivityService/RealtimeGateway — глобальные модули.
@Module({
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
