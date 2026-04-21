import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { Direction, StudentStatus } from '@prisma/client';

import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const uploadStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    const id = randomUUID();
    cb(null, `${id}${extname(file.originalname)}`);
  },
});

@UseGuards(JwtAuthGuard)
@Controller('students')
export class StudentsController {
  constructor(private students: StudentsService) {}

  @Get()
  list(
    @Query('direction') direction?: Direction,
    @Query('status') status?: StudentStatus,
    @Query('cabinet') cabinet?: string,
    @Query('search') search?: string,
  ) {
    return this.students.findAll({
      direction,
      status,
      cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
      search,
    });
  }

  @Get('stats')
  stats() {
    return this.students.stats();
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.students.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateStudentDto) {
    return this.students.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.students.remove(id);
  }

  // Загрузка фото студента
  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Только изображения'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не передан');
    const url = `/uploads/${file.filename}`;
    return this.students.update(id, { photoUrl: url });
  }

  // Загрузка документа студента
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
    }),
  )
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type?: string,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const url = `/uploads/${file.filename}`;
    return this.students.addDocument(
      id,
      {
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url,
      },
      type || 'OTHER',
    );
  }

  @Delete('documents/:docId')
  removeDocument(@Param('docId') docId: string) {
    return this.students.removeDocument(docId);
  }
}
