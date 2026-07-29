import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Direction } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { StudentAuthService } from './student-auth.service';
import { StudentJwtGuard } from './student-jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
// Проблема G аудита: раньше этот Set дублировался дословно здесь и в
// student-auth.service.ts — единственный источник теперь common/access.ts.
import { STUDENT_RESTRICTED_DOC_TYPES } from '../common/access';
import { assertUploadableDocumentType } from '../common/documents';
import { assertNotReceiptDocument } from '../payments/payment-rules';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StudentForgotPasswordDto, StudentLoginDto } from './dto/student-login.dto';
import { clearStudentCookie, setStudentCookie } from '../auth/cookie-helpers';

const uploadStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    const id = randomUUID();
    cb(null, `${id}${extname(file.originalname)}`);
  },
});

// Видео — любое (`video/...`), формат не важен.
const ALLOWED_DOC_MIME_RE =
  /^(image\/(jpeg|jpg|png|webp|heic|heif|gif)|video\/.+|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|zip|x-zip-compressed|x-rar-compressed|vnd\.rar)|text\/plain)$/i;
const ALLOWED_DOC_EXT_RE =
  /\.(jpe?g|png|webp|heic|heif|gif|pdf|docx?|xlsx?|zip|rar|txt|mp4|mov|m4v|webm|mkv|avi|wmv|flv|3gp|ogv)$/i;

const docFileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (ALLOWED_DOC_MIME_RE.test(file.mimetype) || ALLOWED_DOC_EXT_RE.test(file.originalname)) {
    return cb(null, true);
  }
  cb(
    new BadRequestException(
      'Недопустимый тип файла. Разрешены: PDF, изображения, видео (MP4/MOV/WEBM/...), Word, Excel, ZIP/RAR, TXT.',
    ),
    false,
  );
};

/**
 * Multer кладёт original filename в latin1 (HTTP RFC). Кириллица превращается
 * в "Đ¤Đ¾Ñ‚Đ¾_34.jpg" вместо "Фото_34.jpg". Конвертируем обратно в UTF-8.
 */
function fixFilenameEncoding(name: string): string {
  if (!name) return name;
  try {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    if (!utf8.includes('�')) return utf8;
  } catch {
    // ignore
  }
  return name;
}

@Controller('student-auth')
export class StudentAuthController {
  constructor(
    private auth: StudentAuthService,
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  // Лимит: 10 попыток входа в минуту с одного IP — защита от брутфорса.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() body: StudentLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password);
    if (result?.token) {
      setStudentCookie(res, result.token, req);
    }
    // Возвращаем `token` для legacy-клиентов; новые читают только cookie.
    return result;
  }

  /** Логаут студента — очищает httpOnly cookie. */
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    clearStudentCookie(res, req);
    return { ok: true };
  }

  // Forgot password: студент вводит email — на него высылается новый
  // одноразовый пароль. Лимит: 3 запроса в минуту с IP (anti-spam).
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  forgotPassword(@Body() body: StudentForgotPasswordDto) {
    return this.auth.forgotPassword(body.email);
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
      select: { applicationForm: true, managerId: true, chinaManagerId: true },
    });
    this.realtime.emitForStudent(updated, 'form:updated', { studentId: user.id }, { studentId: user.id });
    this.realtime.emitForStudent(updated, 'student:updated', { studentId: user.id }, { studentId: user.id });
    return { form: updated.applicationForm };
  }

  // Студент загружает свой документ
  @UseGuards(StudentJwtGuard)
  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10) },
      fileFilter: docFileFilter,
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
    // Проблема 10/17 аудита волны 1: та же дыра, что в students.controller.ts —
    // студент мог передать произвольный type, включая 'RECEIPT'.
    assertUploadableDocumentType(docType);
    if (docType !== 'OTHER') {
      // Soft-delete старые документы того же типа — заменяются на новый.
      // updateMany вместо deleteMany: данные физически остаются в БД.
      await this.prisma.document.updateMany({
        where: { studentId: user.id, type: docType, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    const doc = await this.prisma.document.create({
      data: {
        studentId: user.id,
        filename: file.filename,
        originalName: fixFilenameEncoding(file.originalname),
        mimeType: file.mimetype,
        size: file.size,
        url,
        type: docType,
      },
    });
    const managers = await this.prisma.student.findUnique({
      where: { id: user.id },
      select: { managerId: true, chinaManagerId: true },
    });
    // Проблема B аудита: раньше в payload летел весь `doc`, включая `url` —
    // прямую ссылку на файл. Теперь только id, фронт (StudentDetail.tsx,
    // StudentCabinet.tsx) перезапрашивает документ по HTTP с уже
    // проверенными правами (и /uploads теперь тоже защищён — Проблема E).
    this.realtime.emitForStudent(
      managers ?? {},
      'document:uploaded',
      { studentId: user.id, docId: doc.id },
      { studentId: user.id },
    );
    this.realtime.emitForStudent(managers ?? {}, 'student:updated', { studentId: user.id }, { studentId: user.id });
    // Если это ограниченный тип — не отдаём URL самому студенту.
    // Файл в БД и в /uploads остаётся, менеджер увидит его в CRM как обычно.
    if (STUDENT_RESTRICTED_DOC_TYPES.has(docType)) {
      return { ...doc, url: '', restricted: true };
    }
    return doc;
  }

  // Программы — доступны студенту (только опубликованные)
  @UseGuards(StudentJwtGuard)
  @Get('programs')
  async listPrograms(
    @Query('city') city?: string,
    @Query('major') major?: string,
    @Query('direction') direction?: Direction,
    @Query('minCost') minCost?: string,
    @Query('maxCost') maxCost?: string,
    @Query('search') search?: string,
  ) {
    const where: any = { published: true, deletedAt: null };
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (major) where.major = { contains: major, mode: 'insensitive' };
    if (direction) where.direction = direction;
    if (minCost || maxCost) {
      where.cost = {};
      if (minCost) where.cost.gte = Number(minCost);
      if (maxCost) where.cost.lte = Number(maxCost);
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { university: { contains: search, mode: 'insensitive' } },
        { major: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.program.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseGuards(StudentJwtGuard)
  @Get('programs/filters')
  async programFilters() {
    const [cities, majors] = await Promise.all([
      this.prisma.program.findMany({
        where: { published: true, deletedAt: null },
        select: { city: true },
        distinct: ['city'],
        orderBy: { city: 'asc' },
      }),
      this.prisma.program.findMany({
        where: { published: true, deletedAt: null },
        select: { major: true },
        distinct: ['major'],
        orderBy: { major: 'asc' },
      }),
    ]);
    return {
      cities: cities.map((c) => c.city),
      majors: majors.map((m) => m.major),
    };
  }

  @UseGuards(StudentJwtGuard)
  @Delete('documents/:docId')
  async removeDocument(@CurrentUser() user: any, @Param('docId') docId: string) {
    // Soft-delete: ищем только активный, помечаем deletedAt.
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, deletedAt: null },
    });
    if (!doc || doc.studentId !== user.id) {
      throw new BadRequestException('Документ не найден');
    }
    // Проблема 2 аудита волны 1: студент — наименее доверенная сторона,
    // id чека приезжает ему по WebSocket-событию (payment:receipt-added),
    // и без этой проверки он мог сам уничтожить доказательство собственного
    // платежа. Чек управляется только payments/, студенту нельзя трогать
    // ни свой, ни (тем более) чужой.
    assertNotReceiptDocument(doc);
    await this.prisma.document.update({
      where: { id: docId },
      data: { deletedAt: new Date() },
    });
    const managers = await this.prisma.student.findUnique({
      where: { id: user.id },
      select: { managerId: true, chinaManagerId: true },
    });
    this.realtime.emitForStudent(
      managers ?? {},
      'document:deleted',
      { studentId: user.id, docId },
      { studentId: user.id },
    );
    this.realtime.emitForStudent(managers ?? {}, 'student:updated', { studentId: user.id }, { studentId: user.id });
    return { ok: true };
  }
}
