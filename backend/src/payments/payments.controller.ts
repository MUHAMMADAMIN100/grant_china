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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
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

/**
 * Канонический тип чека — ЕДИНСТВЕННЫЙ источник и расширения на диске, и
 * mimeType в базе. Ни то, ни другое больше не берётся из присланного клиентом.
 *
 * Раньше расширение бралось из extname(originalname), а mimeType — прямо из
 * заголовка части. Оба целиком под контролем загружающего: файл с именем
 * evil.html и заголовком application/pdf ложился на диск как <uuid>.html, а
 * имя ok.jpg с заголовком text/html записывало text/html в Document.mimeType,
 * откуда он уезжал в заголовок ответа при отдаче файла.
 *
 * Сегодня к исполнению это не приводит (uploads.controller.ts отдаёт неизвестные
 * типы как attachment, плюс nosniff от helmet), но вся защита держится на одном
 * allow-list в другом модуле, а рядом живёт аварийный рубильник
 * UPLOADS_PROTECTED=0, возвращающий раздачу файлов с диска по расширению —
 * и тогда .html поедет inline с origin API. Проще не создавать такой файл.
 */
const RECEIPT_TYPES: Array<{ ext: string; mime: string; extRe: RegExp; mimeRe: RegExp }> = [
  { ext: '.jpg', mime: 'image/jpeg', extRe: /\.jpe?g$/i, mimeRe: /^image\/jpe?g$/i },
  { ext: '.png', mime: 'image/png', extRe: /\.png$/i, mimeRe: /^image\/png$/i },
  { ext: '.webp', mime: 'image/webp', extRe: /\.webp$/i, mimeRe: /^image\/webp$/i },
  { ext: '.heic', mime: 'image/heic', extRe: /\.heic$/i, mimeRe: /^image\/heic$/i },
  { ext: '.heif', mime: 'image/heif', extRe: /\.heif$/i, mimeRe: /^image\/heif$/i },
  { ext: '.pdf', mime: 'application/pdf', extRe: /\.pdf$/i, mimeRe: /^application\/pdf$/i },
  {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extRe: /\.docx$/i,
    mimeRe: /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/i,
  },
];

/**
 * MIME приоритетнее расширения: заголовок ставит браузер по фактическому
 * содержимому, а имя набирает человек. Если MIME неизвестен (HEIC с айфона
 * часто приезжает как application/octet-stream) — падаем на расширение.
 * null означает «ни то, ни другое не опознано» — такой файл фильтр не пропустит.
 */
function canonicalReceiptType(file: { mimetype: string; originalname: string }) {
  return (
    RECEIPT_TYPES.find((t) => t.mimeRe.test(file.mimetype)) ??
    RECEIPT_TYPES.find((t) => t.extRe.test(file.originalname)) ??
    null
  );
}

const receiptStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    const id = randomUUID();
    const canonical = canonicalReceiptType(file);
    // Фильтр уже отбил всё, что не опознано, поэтому ветка с extname
    // недостижима; оставлена, чтобы будущая правка фильтра не привела к
    // файлу вообще без расширения.
    cb(null, `${id}${canonical ? canonical.ext : extname(file.originalname)}`);
  },
});

/**
 * ТЗ v3 раздел 2 — «убрать текущее ограничение, реализовать полноценную
 * мультизагрузку»; критерий приёмки (решение заказчика) — до 15 файлов ЗА ОДНУ
 * загрузку. Это лимит именно на запрос, а не на платёж: общее число чеков у
 * платежа и у студента не ограничено, догрузить можно сколько угодно раз.
 * Верхняя граница нужна, чтобы один multipart-запрос не занял диск и воркер
 * на минуты (15 × 20 МБ = 300 МБ — уже потолок разумного).
 */
export const MAX_RECEIPT_FILES = 15;

// Чек — фото, PDF или DOCX, НЕ переиспользуем docFileFilter из
// students.controller.ts (тот пропускает видео до 200 МБ — «чеком» тогда будут
// заливать что угодно).
//
// DOCX добавлен по ТЗ v3 раздел 2 («Поддержка PDF, JPG, PNG, WEBP, HEIC,
// DOCX»): бухгалтерия части университетов присылает подтверждение оплаты
// именно вордовским файлом. Старый .doc сознательно НЕ включён — в ТЗ его нет,
// а список форматов держим ровно таким, какой обещан интерфейсом, иначе
// клиентская и серверная проверки разъедутся.
const ALLOWED_RECEIPT_MIME_RE =
  /^(image\/(jpeg|jpg|png|webp|heic|heif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i;
const ALLOWED_RECEIPT_EXT_RE = /\.(jpe?g|png|webp|heic|heif|pdf|docx)$/i;
const RECEIPT_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 МБ — с запасом для фото чека/квитанции

const receiptFileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  // Достаточно совпадения ОДНОГО из двух — и это осознанно, а не небрежность.
  // Требовать совпадения обоих нельзя: HEIC с айфона регулярно приезжает с
  // Content-Type: application/octet-stream, и строгая проверка отбивала бы
  // фотографию чека, снятую телефоном, — самый частый способ его приложить.
  //
  // Опасность «или» в другом: оба входа под контролем клиента, и раньше из них
  // же собиралось имя файла на диске и mimeType в базе. Имя evil.html с
  // заголовком application/pdf проходило фильтр и ложилось на диск как .html,
  // а имя ok.jpg с заголовком text/html сохраняло text/html в Document.mimeType,
  // откуда он попадал в заголовок ответа при отдаче файла.
  //
  // Закрыто не ужесточением фильтра, а тем, что НИ расширение на диске, НИ
  // mimeType в базе больше не берутся из присланного: и то и другое
  // выводится из белого списка (canonicalReceiptType ниже).
  if (!(ALLOWED_RECEIPT_MIME_RE.test(file.mimetype) || ALLOWED_RECEIPT_EXT_RE.test(file.originalname))) {
    return cb(new BadRequestException('Чек должен быть фото (JPG/PNG/WEBP/HEIC), PDF или DOCX'), false);
  }
  // Счётчик живёт на объекте ЗАПРОСА, а не в замыкании модуля: объект
  // receiptUploadOptions один на всё приложение, и общий счётчик склеил бы
  // параллельные загрузки разных менеджеров — шестнадцатый файл «чужого»
  // запроса отбивался бы у того, кто грузит первый.
  req.__receiptFileCount = (req.__receiptFileCount ?? 0) + 1;
  if (req.__receiptFileCount > MAX_RECEIPT_FILES) {
    return cb(
      new BadRequestException(`За одну загрузку можно приложить не более ${MAX_RECEIPT_FILES} файлов`),
      false,
    );
  }
  cb(null, true);
};

const receiptUploadOptions = {
  storage: receiptStorage,
  limits: {
    fileSize: RECEIPT_MAX_FILE_SIZE,
    // На ЕДИНИЦУ больше лимита ТЗ — это не опечатка. Жёсткий предохранитель
    // busboy обрывает запрос своим кодом LIMIT_FILE_COUNT, который Nest
    // превращает в англоязычное «Too many files». Пропустив 16-й файл до
    // fileFilter, мы отдаём пользователю понятное русское объяснение выше,
    // а сам предохранитель по-прежнему не даёт залить 500 файлов разом.
    files: MAX_RECEIPT_FILES + 1,
  },
  fileFilter: receiptFileFilter,
};

/**
 * Приводит Express.Multer.File[] к лёгкому контракту сервиса (без Express-типов
 * внутри payments.service.ts). Всегда массив — пустой, если файлов не прислали.
 */
function toReceiptInputs(files: Express.Multer.File[] | undefined): ReceiptFileInput[] {
  const list = files ?? [];
  // Пустой файл — не подтверждение оплаты. Проверять это в fileFilter нельзя:
  // на момент его вызова размер ещё неизвестен (multer зовёт фильтр по
  // заголовкам части, до чтения тела), поэтому отсекаем здесь.
  //
  // Инвариант ТЗ 1.3 требует «хотя бы один чек» для Проживания и Питания —
  // и файл в ноль байт формально его закрывал, не давая никакого реального
  // доказательства. Именно поэтому это не косметика.
  const empty = list.find((f) => !f.size);
  if (empty) {
    throw new BadRequestException(
      `Файл «${fixFilenameEncoding(empty.originalname)}» пустой (0 байт) — он не может служить подтверждением оплаты`,
    );
  }
  return list.map((file) => ({
    filename: file.filename,
    originalName: fixFilenameEncoding(file.originalname),
    // Канонический тип из белого списка, а НЕ присланный заголовок: именно он
    // потом уезжает в Content-Type при отдаче файла (uploads.controller.ts).
    // Раньше сюда попадал сырой mimetype, и text/html, приложенный к файлу с
    // именем ok.jpg, сохранялся в базе как есть.
    mimeType: canonicalReceiptType(file)?.mime ?? file.mimetype,
    size: file.size,
    url: `/uploads/${file.filename}`,
  }));
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

  /**
   * ТЗ v3 раздел 2 — мультизагрузка чеков прямо в модалке оплаты.
   *
   * AnyFilesInterceptor, а не FilesInterceptor('files'): имя поля у нас
   * исторически `file` (см. api/payments.ts createPayment), а новый клиент
   * шлёт `files[]`. FilesInterceptor привязан к ОДНОМУ имени и на любое другое
   * отвечает LIMIT_UNEXPECTED_FILE — то есть переименование поля мгновенно
   * сломало бы всех, у кого в браузере остался старый бандл (а он живёт до
   * перезагрузки вкладки). AnyFilesInterceptor принимает оба имени, все файлы
   * одинаково становятся Document type=RECEIPT, лимит и фильтр форматов держит
   * receiptUploadOptions.
   */
  @Post()
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  @UseInterceptors(AnyFilesInterceptor(receiptUploadOptions))
  create(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.payments.create(dto, toReceiptInputs(files), user);
  }

  @Patch(':id')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  update(@Param('id') id: string, @Body() dto: UpdatePaymentDto, @CurrentUser() user: any) {
    return this.payments.update(id, dto, user);
  }

  @Post(':id/submit')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  submit(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payments.submit(id, user);
  }

  @Post(':id/recall')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
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
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.payments.remove(id, user);
  }

  /** Догрузка чеков к существующему платежу — тоже пачкой (ТЗ v3 раздел 2). Возвращает МАССИВ созданных документов. */
  @Post(':id/receipts')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  @UseInterceptors(AnyFilesInterceptor(receiptUploadOptions))
  addReceipt(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: any,
  ) {
    return this.payments.addReceipt(id, toReceiptInputs(files), user);
  }

  @Delete('receipts/:docId')
  @Roles(Role.FOUNDER, Role.ADMIN, Role.EMPLOYEE)
  removeReceipt(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.payments.removeReceipt(docId, user);
  }
}
