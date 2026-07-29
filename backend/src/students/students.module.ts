import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';

@Module({
  // FilesModule нужен, чтобы StudentsService мог инвалидировать приватный
  // кэш FileResolverService при переназначении менеджера/удалении студента/
  // документа (Проблема 7 аудита волны 1) — FilesModule ничего не импортирует
  // из StudentsModule, циклической зависимости нет.
  imports: [NotificationsModule, FilesModule],
  providers: [StudentsService],
  controllers: [StudentsController],
})
export class StudentsModule {}
