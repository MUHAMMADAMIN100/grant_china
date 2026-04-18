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
import { ApplicationStatus, Direction } from '@prisma/client';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('applications')
export class ApplicationsController {
  constructor(private apps: ApplicationsService) {}

  // Публичный endpoint для лендинга (без авторизации)
  @Post('public')
  createFromLanding(@Body() dto: CreateApplicationDto) {
    return this.apps.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @Query('status') status?: ApplicationStatus,
    @Query('direction') direction?: Direction,
    @Query('search') search?: string,
  ) {
    return this.apps.findAll({ status, direction, search });
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats')
  stats() {
    return this.apps.stats();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  one(@Param('id') id: string) {
    return this.apps.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.apps.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/convert')
  convert(@Param('id') id: string) {
    return this.apps.convertToStudent(id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.apps.remove(id);
  }
}
