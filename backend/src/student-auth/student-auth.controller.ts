import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { StudentAuthService } from './student-auth.service';
import { StudentJwtGuard } from './student-jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const uploadStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    const id = randomUUID();
    cb(null, `${id}${extname(file.originalname)}`);
  },
});

@Controller('student-auth')
export class StudentAuthController {
  constructor(
    private auth: StudentAuthService,
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @UseGuards(StudentJwtGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    return this.auth.me(user.id);
  }

  @UseGuards(StudentJwtGuard)
  @Get('form')
  async getForm(@CurrentUser() user: any) {
    const s = await this.prisma.student.findUnique({
      where: { id: user.id },
      select: { applicationForm: true },
    });
    return { form: s?.applicationForm || null };
  }

  @UseGuards(StudentJwtGuard)
  @Patch('form')
  async updateForm(@CurrentUser() user: any, @Body() form: any) {
    const updated = await this.prisma.student.update({
      where: { id: user.id },
      data: { applicationForm: form },
      select: { applicationForm: true },
    });
    this.realtime.emitStudentAndStaff(user.id, 'form:updated', { studentId: user.id });
    this.realtime.emitStudentAndStaff(user.id, 'student:updated', { studentId: user.id });
    return { form: updated.applicationForm };
  }

  // Студент загружает свой документ
  @UseGuards(StudentJwtGuard)
  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
    }),
  )
  async uploadDocument(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: string | undefined,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const url = `/uploads/${file.filename}`;
    const docType = type || 'OTHER';
    if (docType !== 'OTHER') {
      await this.prisma.document.deleteMany({ where: { studentId: user.id, type: docType } });
    }
    const doc = await this.prisma.document.create({
      data: {
        studentId: user.id,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url,
        type: docType,
      },
    });
    this.realtime.emitStudentAndStaff(user.id, 'document:uploaded', { studentId: user.id, doc });
    this.realtime.emitStudentAndStaff(user.id, 'student:updated', { studentId: user.id });
    return doc;
  }

  @UseGuards(StudentJwtGuard)
  @Delete('documents/:docId')
  async removeDocument(@CurrentUser() user: any, @Param('docId') docId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: docId } });
    if (!doc || doc.studentId !== user.id) {
      throw new BadRequestException('Документ не найден');
    }
    await this.prisma.document.delete({ where: { id: docId } });
    this.realtime.emitStudentAndStaff(user.id, 'document:deleted', { studentId: user.id, docId });
    this.realtime.emitStudentAndStaff(user.id, 'student:updated', { studentId: user.id });
    return { ok: true };
  }
}
