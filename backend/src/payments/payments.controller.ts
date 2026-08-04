import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { PaymentKind, PaymentMethod, PaymentPurpose, PaymentStage, PaymentStatus, Role } from '@prisma/client';

import { PaymentsService, ReceiptFileInput } from './payments.service';
import { CreatePaymentDto, ApprovePaymentDto, RejectPaymentDto, VoidPaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { SetScheduleDto } from './dto/set-schedule.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { fixFilenameEncoding } from '../common/upload-utils';
import { parsePage, parsePageSize } from '../common/pagination';

const receiptStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    const id = randomUUID();
    cb(null, `${id}${extname(file.originalname)}`);
  },
});

// Чек — фото или PDF, НЕ переиспользуем docFileFilter из students.controller.ts
// (тот пропускает видео до 200 МБ — «чеком» тогда будут заливать что угодно).
const ALLOWED_RECEIPT_MIME_RE = /^(image\/(jpeg|jpg|png|webp|heic|heif)|application\/pdf)$/i;
const ALLOWED_RECEIPT_EXT_RE = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;
const RECEIPT_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 МБ — с запасом для фото чека/квитанции

const receiptFileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (ALLOWED_RECEIPT_MIME_RE.test(file.mimetype) || ALLOWED_RECEIPT_EXT_RE.test(file.originalname)) {
    return cb(null, true);
  }
  cb(new BadRequestException('Чек должен быть фото (JPG/PNG/WEBP/HEIC) или PDF'), false);
};

const receiptUploadOptions = {
  storage: receiptStorage,
  limits: { fileSize: RECEIPT_MAX_FILE_SIZE },
  fileFilter: receiptFileFilter,
};

/** Приводит Express.Multer.File к лёгкому контракту сервиса (без Express-типов внутри payments.service.ts). */
function toReceiptInput(file: Express.Multer.File | undefined): ReceiptFileInput | undefined {
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
 * Double Check (ТЗ 1.1): RolesGuard навешен явно на контроллер (он не
 * глобальный, см. auth/roles.guard.ts) — approve/reject/void закрыты
 * @Roles(Role.FOUNDER), очередь на одобрение и отчётные списки — @Roles(FOUNDER, ADMIN).
 *
 * ТЗ v3 раздел 4 (критерий приёмки №4): «Администратор имеет доступ к финансам
 * СТРОГО в режиме Read-Only». Раньше методы записи стояли вообще без @Roles, а
 * RolesGuard без декоратора пропускает ЛЮБОГО авторизованного (см. `if (!required
 * || required.length === 0) return true` в roles.guard.ts) — то есть Администратор
 * свободно создавал, правил, подавал, отзывал и удалял платежи.
 *
 * Теперь на КАЖДОМ методе записи стоит @Roles(FOUNDER, EMPLOYEE) — явный список
 * разрешённых, а не `кроме ADMIN`. Разница принципиальна: при появлении новой
 * роли она по умолчанию окажется БЕЗ доступа к деньгам, а не с ним.
 *
 * EMPLOYEE в списке намеренно: по той же таблице ТЗ менеджер платежи проводить
 * может, но только по своим студентам — это сужение делает сервис через
 * canAccessStudentRecord, роль его не заменяет.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('studentId') studentId?: string,
    @Query('status') status?: PaymentStatus,
    @Query('stage') stage?: PaymentStage,
    @Query('kind') kind?: PaymentKind,
    @Query('purpose') purpose?: PaymentPurpose,
    @Query('method') method?: PaymentMethod,
    @Query('managerId') managerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.payments.findAll(
      {
        studentId,
        status,
        stage,
        kind,
        purpose,
        method,
        managerId,
        from: parseDateParam(from),
        to: parseDateParam(to),
        search,
        page: parsePage(page),
        pageSize: parsePageSize(pageSize),
      },
      user,
    );
  }

  @Get('pending')
  @Roles(Role.FOUNDER, Role.ADMIN)
  pending(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.payments.findPending({
      page: parsePage(page),
      pageSize: parsePageSize(pageSize),
    });
  }

  @Get('pending/count')
  @Roles(Role.FOUNDER, Role.ADMIN)
  pendingCount() {
    return this.payments.pendingCount();
  }

  @Get('summary')
  summary(@Query('studentId') studentId: string, @CurrentUser() user: any) {
    return this.payments.summary(studentId, user);
  }

  @Get('schedule')
  schedule(@Query('studentId') studentId: string, @CurrentUser() user: any) {
    return this.payments.getSchedule(studentId, user);
  }

  // График платежей — плановые суммы и сроки. Это управленческая настройка
  // финансового контура («управленческие отчёты» в строке Основателя ТЗ v3),
  // поэтому здесь только FOUNDER: ADMIN сюда больше не пускается, а EMPLOYEE
  // не пускался и раньше.
  @Put('schedule')
  @Roles(Role.FOUNDER)
  setSchedule(@Body() dto: SetScheduleDto, @CurrentUser() user: any) {
    return this.payments.setSchedule(dto, user);
  }

  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payments.findOne(id, user);
  }

  @Post()
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  @UseInterceptors(FileInterceptor('file', receiptUploadOptions))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.payments.create(dto, toReceiptInput(file), user);
  }

  @Patch(':id')
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  update(@Param('id') id: string, @Body() dto: UpdatePaymentDto, @CurrentUser() user: any) {
    return this.payments.update(id, dto, user);
  }

  @Post(':id/submit')
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  submit(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payments.submit(id, user);
  }

  @Post(':id/recall')
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  recall(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payments.recall(id, user);
  }

  @Post(':id/approve')
  @Roles(Role.FOUNDER)
  approve(@Param('id') id: string, @Body() dto: ApprovePaymentDto, @CurrentUser() user: any) {
    return this.payments.approve(id, dto.updatedAt, user);
  }

  @Post(':id/reject')
  @Roles(Role.FOUNDER)
  reject(@Param('id') id: string, @Body() dto: RejectPaymentDto, @CurrentUser() user: any) {
    return this.payments.reject(id, dto.reason, user);
  }

  @Post(':id/void')
  @Roles(Role.FOUNDER)
  voidPayment(@Param('id') id: string, @Body() dto: VoidPaymentDto, @CurrentUser() user: any) {
    return this.payments.voidPayment(id, dto.reason, user);
  }

  @Delete(':id')
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payments.remove(id, user);
  }

  @Post(':id/receipts')
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  @UseInterceptors(FileInterceptor('file', receiptUploadOptions))
  addReceipt(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: any,
  ) {
    return this.payments.addReceipt(id, toReceiptInput(file), user);
  }

  @Delete('receipts/:docId')
  @Roles(Role.FOUNDER, Role.EMPLOYEE)
  removeReceipt(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.payments.removeReceipt(docId, user);
  }
}
