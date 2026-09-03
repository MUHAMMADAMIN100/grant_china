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
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { StudentJwtGuard } from './student-jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TicketsService, TicketFileInput } from '../tickets/tickets.service';
import { StudentTicketDto, StudentTicketUpdateDto } from '../tickets/dto/student-ticket.dto';
import { fixFilenameEncoding } from '../common/upload-utils';
import { CHINA_CITIES } from '../common/china-cities';

const ticketStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
});

// Те же пределы, что у сотрудника в tickets.controller.ts: PDF или фото
// квитанции до 20 МБ. Студент — наименее доверенная сторона, шире делать
// нельзя; уже — незачем, файл после подтверждения становится обычным
// файлом билета.
const ALLOWED_TICKET_MIME_RE = /^(image\/(jpeg|jpg|png|heic|heif)|application\/pdf)$/i;
const ALLOWED_TICKET_EXT_RE = /\.(jpe?g|png|heic|heif|pdf)$/i;
const TICKET_MAX_FILE_SIZE = 20 * 1024 * 1024;

const ticketUploadOptions = {
  storage: ticketStorage,
  limits: { fileSize: TICKET_MAX_FILE_SIZE },
  fileFilter: (_req: any, file: Express.Multer.File, cb: (error: Error | null, ok: boolean) => void) => {
    if (ALLOWED_TICKET_MIME_RE.test(file.mimetype) || ALLOWED_TICKET_EXT_RE.test(file.originalname)) {
      return cb(null, true);
    }
    cb(new BadRequestException('Билет должен быть PDF или изображением (JPG/PNG/HEIC)'), false);
  },
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

/**
 * Билеты в личном кабинете студента (26.08.2026).
 *
 * Живёт в StudentAuthModule, а не в TicketsModule, по одной причине:
 * StudentJwtGuard нуждается в JwtService со студенческим секретом, а он
 * зарегистрирован только здесь. Логика при этом целиком в TicketsService —
 * у билета один владелец кода независимо от того, кто его подал.
 *
 * ГРАНИЦА ДОВЕРИЯ. studentId везде берётся из сессии (user.id), в теле
 * запросов его нет. Всё, что студент может: подать СВОЙ билет на проверку,
 * править и отзывать его, ПОКА он на проверке и сотрудник его не трогал.
 * Подтверждённые и отклонённые билеты для него только на чтение — решение
 * заказчика («править, пока менеджер не тронул»).
 *
 * Троттлинг на запись: живому человеку 10 действий в минуту хватит, а
 * циклом заваливать менеджера уведомлениями не выйдет.
 */
@UseGuards(StudentJwtGuard)
@Controller('student-auth/tickets')
export class StudentTicketsController {
  constructor(private tickets: TicketsService) {}

  @Get()
  list(@CurrentUser() user: any) {
    return this.tickets.listForStudent(user.id);
  }

  /** Тот же справочник, что у сотрудника (GET /tickets/cities закрыт staff-guard'ом). */
  @Get('cities')
  cities() {
    return { items: CHINA_CITIES };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @UseInterceptors(FileInterceptor('file', ticketUploadOptions))
  create(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: StudentTicketDto,
  ) {
    return this.tickets.createByStudent(user.id, dto, toTicketFile(file));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: StudentTicketUpdateDto) {
    return this.tickets.updateByStudent(user.id, id, dto);
  }

  /** Отзыв заявки. Soft-delete — правило проекта, данные остаются. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete(':id')
  withdraw(@CurrentUser() user: any, @Param('id') id: string) {
    return this.tickets.withdrawByStudent(user.id, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', ticketUploadOptions))
  addDocument(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.tickets.addDocumentByStudent(user.id, id, toTicketFile(file));
  }

  @Delete(':id/documents/:docId')
  removeDocument(@CurrentUser() user: any, @Param('id') id: string, @Param('docId') docId: string) {
    return this.tickets.removeDocumentByStudent(user.id, id, docId);
  }
}
