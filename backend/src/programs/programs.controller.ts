import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Direction } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { ProgramsService } from './programs.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { isPrivileged } from '../common/roles';

const programImageStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${extname(file.originalname)}`);
  },
});

// 2.2 аудита волны 2: RolesGuard добавлен ПОМЕТОДНО (не на класс) — публичные
// GET /programs/public/* должны остаться доступны анониму с лендинга без
// авторизации вообще. @Roles-декораторы на приватных методах не добавлены:
// ProgramsService уже проверяет isPrivileged() для create/update/remove,
// uploadImage() проверяет её же прямо в контроллере — RolesGuard лишь
// активирует механизм @Roles, не дублируя уже работающие проверки.
@Controller('programs')
export class ProgramsController {
  constructor(private programs: ProgramsService) {}

  // Публичный каталог (для лендинга, без авторизации)
  @Get('public')
  listPublic(
    @Query('city') city?: string,
    @Query('major') major?: string,
    @Query('direction') direction?: Direction,
    @Query('minCost') minCost?: string,
    @Query('maxCost') maxCost?: string,
    @Query('search') search?: string,
  ) {
    return this.programs.findAll({
      city,
      major,
      direction,
      minCost: minCost ? Number(minCost) : undefined,
      maxCost: maxCost ? Number(maxCost) : undefined,
      search,
      publishedOnly: true,
    });
  }

  @Get('public/filters')
  publicFilters() {
    return this.programs.filters();
  }

  @Get('public/:id')
  publicOne(@Param('id') id: string) {
    // publishedOnly=true — неопубликованные черновики программ (внутренние
    // цены и т.п.) не должны быть доступны анониму по прямой ссылке.
    return this.programs.findOne(id, true);
  }

  // Приватный (CRM)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  list(
    @Query('city') city?: string,
    @Query('major') major?: string,
    @Query('direction') direction?: Direction,
    @Query('search') search?: string,
  ) {
    return this.programs.findAll({ city, major, direction, search });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id')
  one(@Param('id') id: string) {
    return this.programs.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: programImageStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10) },
      fileFilter: (_req, file, cb) => {
        if (!/^image\//.test(file.mimetype)) {
          return cb(new BadRequestException('Нужен файл-картинка'), false);
        }
        cb(null, true);
      },
    }),
  )
  async create(
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: any,
  ) {
    // multipart-поля приходят строками — приводим к нужным типам
    const dto: CreateProgramDto = {
      name: String(body.name ?? ''),
      university: String(body.university ?? ''),
      city: String(body.city ?? ''),
      major: String(body.major ?? ''),
      direction: body.direction as Direction,
      cost: body.cost !== undefined ? Number(body.cost) : 0,
      currency: body.currency || undefined,
      duration: body.duration || undefined,
      language: body.language || undefined,
      description: body.description || undefined,
      imageUrl: body.imageUrl || undefined,
      published:
        typeof body.published === 'string'
          ? body.published === 'true'
          : body.published,
    };
    if (file) {
      dto.imageUrl = `/uploads/${file.filename}`;
    }
    if (!dto.name || !dto.university || !dto.city || !dto.major || !dto.direction) {
      throw new BadRequestException('Заполните обязательные поля программы');
    }
    if (!Number.isFinite(dto.cost)) {
      throw new BadRequestException('Стоимость должна быть числом');
    }
    return this.programs.create(dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProgramDto, @CurrentUser() user: any) {
    return this.programs.update(id, dto, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.programs.remove(id, user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: programImageStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '209715200', 10) },
      fileFilter: (_req, file, cb) => {
        if (!/^image\//.test(file.mimetype)) {
          return cb(new BadRequestException('Нужен файл-картинка'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    if (!isPrivileged(user.role)) {
      throw new ForbiddenException('Только Основатель или администратор');
    }
    if (!file) throw new BadRequestException('Файл не передан');
    const imageUrl = `/uploads/${file.filename}`;
    return this.programs.update(id, { imageUrl } as any, user);
  }
}
