import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';
import { ListContentQuery } from './dto/list-content.query';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AnnouncementResponse } from './content.mapper';
import { PaginatedResult } from '../common/pagination.dto';

@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAnnouncementsController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  async listAnnouncements(@Query() query: ListContentQuery): Promise<PaginatedResult<AnnouncementResponse>> {
    return this.contentService.listAnnouncements(query);
  }

  @Get(':id')
  async getAnnouncement(@Param('id') id: string): Promise<AnnouncementResponse> {
    return this.contentService.getAnnouncement(id);
  }

  @Post()
  async createAnnouncement(@Body() dto: CreateAnnouncementDto): Promise<AnnouncementResponse> {
    return this.contentService.createAnnouncement(dto);
  }

  @Patch(':id')
  async updateAnnouncement(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
  ): Promise<AnnouncementResponse> {
    return this.contentService.updateAnnouncement(id, dto);
  }

  @Delete(':id')
  async deleteAnnouncement(@Param('id') id: string): Promise<{ message: string }> {
    return this.contentService.deleteAnnouncement(id);
  }
}
