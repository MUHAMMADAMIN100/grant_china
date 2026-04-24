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
import { CurrentUser } from '../auth/current-user.decorator';

const programImageStorage = diskStorage({
  destination: process.env.UPLOADS_DIR || './uploads',
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${extname(file.originalname)}`);
  },
});

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
    return this.programs.findOne(id);
  }

  // Приватный (CRM)
  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @Query('city') city?: string,
    @Query('major') major?: string,
    @Query('direction') direction?: Direction,
    @Query('search') search?: string,
  ) {
    return this.programs.findAll({ city, major, direction, search });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  one(@Param('id') id: string) {
    return this.programs.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateProgramDto, @CurrentUser() user: any) {
    return this.programs.create(dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProgramDto, @CurrentUser() user: any) {
    return this.programs.update(id, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.programs.remove(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: programImageStorage,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10) },
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
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Только администратор');
    }
    if (!file) throw new BadRequestException('Файл не передан');
    const imageUrl = `/uploads/${file.filename}`;
    return this.programs.update(id, { imageUrl } as any, user);
  }
}
