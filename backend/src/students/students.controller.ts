import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { fixFilenameEncoding } from '../common/upload-utils';
import { assertUploadableDocumentType } from '../common/documents';
import { parsePage, parsePageSize } from '../common/pagination';

const uploadStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    const id = randomUUID();
    cb(null, `${id}${extname(file.originalname)}`);
  },
});

// Разрешённые типы для загрузки документов студента (паспорта, аттестаты,
// справки, видео-презентации и т. п.). Запрещаем исполняемые файлы.
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
      'Недопустимый тип файла. Разрешены: PDF, изображения (JPG/PNG/WEBP/HEIC), видео (MP4/MOV/WEBM/...), Word, Excel, ZIP/RAR, TXT.',
    ),
    false,
  );
};

// 2.2 аудита волны 2: раньше здесь стоял только JwtAuthGuard — @Roles на
// методах этого контроллера молча не работал бы (RolesGuard не глобальный,
// см. auth/roles.guard.ts). @Roles сюда сознательно НЕ добавляем: доступ к
// студентам у EMPLOYEE и так сужен внутри StudentsService (ensureCanEdit/
// canAccessStudentRecord — видит только своих + «свободных»), а привилегированные
// операции (assignManager, regeneratePassword) уже проверяют isPrivileged()
// внутри сервиса. RolesGuard добавлен только чтобы сам механизм @Roles был
// готов к использованию — дублировать уже работающую проверку не нужно.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('students')
export class StudentsController {
  constructor(private students: StudentsService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('direction') direction?: Direction,
    @Query('status') status?: StudentStatus,
    @Query('cabinet') cabinet?: string,
    @Query('search') search?: string,
    @Query('mine') mine?: string,
    @Query('manager') manager?: string,
    @Query('stage') stage?: string,
    // Раздел 4 ТЗ (волна 4) — опциональный фильтр реестра «двойных грантов»
    // прямо в общем списке студентов: 'multi' | 'any' | 'none'. По умолчанию
    // не применяется (undefined) — колонка/фильтр не показывается, пока
    // пользователь явно его не выберет.
    @Query('grant') grant?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.students.findAll({
      direction,
      status,
      cabinet: cabinet ? parseInt(cabinet, 10) : undefined,
      search,
      mine: mine === 'true',
      managerUserId: manager || undefined,
      currentUserId: user?.id,
      currentUserRole: user?.role,
      currentUserRegion: user?.region,
      stage: stage || undefined,
      grant: grant === 'multi' || grant === 'any' || grant === 'none' ? grant : undefined,
      page: parsePage(page),
      pageSize: parsePageSize(pageSize),
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: any) {
    return this.students.stats(user);
  }

  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.students.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateStudentDto, @CurrentUser() user: any) {
    return this.students.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto, @CurrentUser() user: any) {
    return this.students.update(id, dto, user);
  }

  @Patch(':id/manager')
  assignManager(
    @Param('id') id: string,
    @Body() body: { managerId?: string | null; chinaManagerId?: string | null },
    @CurrentUser() user: any,
  ) {
    return this.students.assignManager(id, body, user);
  }

  /**
   * ТЗ «Разделение воронок» — передача студента в китайский офис.
   *
   * Без @Roles намеренно: право проверяется в сервисе по КОНКРЕТНОМУ студенту
   * (передаёт назначенный таджикский менеджер либо руководство), а роль сама по
   * себе тут ничего не решает — чужого студента не передаст и менеджер.
   */
  /** Кандидаты на приём студента в Китае — для окна выбора. Право = право передать. */
  @Get(':id/china-managers')
  chinaTransferCandidates(@Param('id') id: string, @CurrentUser() user: any) {
    return this.students.chinaTransferCandidates(id, user);
  }

  @Post(':id/transfer-to-china')
  transferToChina(
    @Param('id') id: string,
    @Body() body: { chinaManagerId: string },
    @CurrentUser() user: any,
  ) {
    return this.students.transferToChina(id, body?.chinaManagerId, user);
  }

  /** Возврат в таджикский офис — только Основатель (проверяется в сервисе). */
  @Post(':id/return-from-china')
  returnFromChina(@Param('id') id: string, @CurrentUser() user: any) {
    return this.students.returnFromChina(id, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.students.remove(id, user);
  }

  @Post(':id/regenerate-password')
  regeneratePassword(@Param('id') id: string, @CurrentUser() user: any) {
    return this.students.regeneratePassword(id, user);
  }

  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10) },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Только изображения'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const url = `/uploads/${file.filename}`;
    return this.students.update(id, { photoUrl: url }, user);
  }

  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10) },
      fileFilter: docFileFilter,
    }),
  )
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('type') type: string | undefined,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const docType = type || 'OTHER';
    // Проблема 10 аудита волны 1: type раньше принимался произвольной строкой
    // без белого списка — RECEIPT через этот эндпоинт запрещён явно.
    assertUploadableDocumentType(docType);
    const url = `/uploads/${file.filename}`;
    return this.students.addDocument(
      id,
      {
        filename: file.filename,
        originalname: fixFilenameEncoding(file.originalname),
        mimetype: file.mimetype,
        size: file.size,
        url,
      },
      docType,
      user,
    );
  }

  @Delete('documents/:docId')
  removeDocument(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.students.removeDocument(docId, user);
  }

  @Post(':id/ensure-application')
  ensureApplication(@Param('id') id: string, @CurrentUser() user: any) {
    return this.students.ensureApplication(id, user);
  }

  @Patch(':id/form')
  updateForm(@Param('id') id: string, @Body() form: any, @CurrentUser() user: any) {
    return this.students.updateForm(id, form, user);
  }
}
