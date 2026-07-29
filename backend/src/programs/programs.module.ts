import { Module } from '@nestjs/common';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { TelegramModule } from '../telegram/telegram.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [TelegramModule, FilesModule],
  controllers: [ProgramsController],
  providers: [ProgramsService],
})
export class ProgramsModule {}
