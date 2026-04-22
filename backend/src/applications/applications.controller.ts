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
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('applications')
export class ApplicationsController {
  constructor(private apps: ApplicationsService) {}

  @Post('public')
  createFromLanding(@Body() dto: CreateApplicationDto) {
    return this.apps.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @CurrentUser() user: any,
    @Query('status') status?: ApplicationStatus,
    @Query('direction') direction?: Direction,
    @Query('search') search?: string,
    @Query('mine') mine?: string,
  ) {
    return this.apps.findAll({
      status,
      direction,
      search,
      mine: mine === 'true',
      currentUserId: user?.id,
    });
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() user: any,
  ) {
    return this.apps.update(id, dto, user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/manager')
  assignManager(
    @Param('id') id: string,
    @Body('managerId') managerId: string | null,
    @CurrentUser() user: any,
  ) {
    return this.apps.assignManager(id, managerId, user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.apps.remove(id, user);
  }
}
