import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ContentService } from './content.service';
import { CreateLiveStreamDto } from './dto/create-live-stream.dto';
import { UpdateLiveStreamDto } from './dto/update-live-stream.dto';

@Controller('admin/live-streams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminLiveStreamsController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  listLiveStreams() {
    return this.contentService.listLiveStreams();
  }

  @Post()
  createLiveStream(@Body() dto: CreateLiveStreamDto) {
    return this.contentService.createLiveStream(dto);
  }

  @Patch(':id')
  updateLiveStream(@Param('id') id: string, @Body() dto: UpdateLiveStreamDto) {
    return this.contentService.updateLiveStream(id, dto);
  }

  @Delete(':id')
  deleteLiveStream(@Param('id') id: string) {
    return this.contentService.deleteLiveStream(id);
  }
}
