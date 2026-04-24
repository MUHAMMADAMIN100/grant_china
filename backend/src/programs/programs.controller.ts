import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Direction } from '@prisma/client';
import { ProgramsService } from './programs.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

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
}
