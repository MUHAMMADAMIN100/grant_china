import {
  BadRequestException,
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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { Role, TicketStatus } from '@prisma/client';

import { TicketsService, TicketFileInput } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { fixFilenameEncoding } from '../common/upload-utils';
import { parsePage, parsePageSize } from '../common/pagination';
import { CHINA_CITIES } from '../common/china-cities';

const ticketStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    const id = randomUUID();
    cb(null, `${id}${extname(file.originalname)}`);
  },
});

// ТЗ п.3: «Файл билета / Маршрутная квитанция (Загрузка файлов: PDF, JPEG, PNG)».
// Список УЖЕ, чем у документов студента (там проходят видео до 200 МБ) — по той
// же причине, по которой чек платежа имеет свой фильтр: иначе «билетом» станут
// заливать что угодно. HEIC добавлен сверх ТЗ осознанно: это формат по
// умолчанию у камеры iPhone, и менеджер фотографирует квитанцию телефоном.
const ALLOWED_TICKET_MIME_RE = /^(image\/(jpeg|jpg|png|heic|heif)|application\/pdf)$/i;
const ALLOWED_TICKET_EXT_RE = /\.(jpe?g|png|heic|heif|pdf)$/i;
const TICKET_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 МБ — с запасом для скана

const ticketFileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (ALLOWED_TICKET_MIME_RE.test(file.mimetype) || ALLOWED_TICKET_EXT_RE.test(file.originalname)) {
    return cb(null, true);
  }
  cb(new BadRequestException('Билет должен быть PDF или изображением (JPG/PNG/HEIC)'), false);
};

const ticketUploadOptions = {
  storage: ticketStorage,
  limits: { fileSize: TICKET_MAX_FILE_SIZE },
  fileFilter: ticketFileFilter,
};

function toTicketFile(file: Express.Multer.File | undefined): TicketFileInput | undefined {
  if (!file) return undefined;
  return {
    filename: file.filename,
    originalName: fixFilenameEncoding(file.originalname),
    mimeType: file.mimetype,
    size: file.size,
    url: `/uploads/${file.filename}`,
  };
}

function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Раздел «Билеты» (волна 8). RolesGuard навешен на класс, но @Roles стоит
 * ТОЛЬКО на удалении: по ТЗ п.2 менеджер создаёт и редактирует билеты своих
 * студентов, а удаление — прерогатива администратора. Остальная видимость
 * режется внутри TicketsService по владению студентом (тот же приём, что в
 * grants/ и contracts/).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('status') status?: TicketStatus,
    @Query('city') city?: string,
    @Query('studentId') studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tickets.findAll(
      {
        status,
        destinationCity: city || undefined,
        studentId: studentId || undefined,
        from: parseDateParam(from),
        to: parseDateParam(to),
        search: search || undefined,
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  @Get('stats')
  stats(@CurrentUser() user: any) {
    return this.tickets.stats(user);
  }

  /**
   * Справочник городов для выпадающего списка (ТЗ 4.3). Отдаётся с бэкенда, а
   * не хардкодится во фронте, чтобы добавление города не требовало пересборки
   * обоих приложений — тот же принцип, что у lead-source.
   */
  @Get('cities')
  cities() {
    return { items: CHINA_CITIES };
  }

  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.tickets.findOne(id, user);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', ticketUploadOptions))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: any,
  ) {
    return this.tickets.create(dto, toTicketFile(file), user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @CurrentUser() user: any) {
    return this.tickets.update(id, dto, user);
  }

  // ТЗ п.2: «Администратор: ... возможность удаления». Менеджер редактирует,
  // но не удаляет — иначе потерянный билет невозможно отличить от того,
  // который просто не завели.
  @Delete(':id')
  @Roles(Role.FOUNDER, Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.tickets.remove(id, user);
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', ticketUploadOptions))
  addDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: any,
  ) {
    return this.tickets.addDocument(id, toTicketFile(file), user);
  }

  @Delete('documents/:docId')
  removeDocument(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.tickets.removeDocument(docId, user);
  }
}
