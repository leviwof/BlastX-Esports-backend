import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';
import { ListContentQuery } from './dto/list-content.query';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { UpdateNoticeDto } from './dto/update-notice.dto';
import { NoticeResponse } from './content.mapper';
import { PaginatedResult } from '../common/pagination.dto';

@Controller('admin/notices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminNoticesController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  async listNotices(@Query() query: ListContentQuery): Promise<PaginatedResult<NoticeResponse>> {
    return this.contentService.listNotices(query);
  }

  @Get(':id')
  async getNotice(@Param('id') id: string): Promise<NoticeResponse> {
    return this.contentService.getNotice(id);
  }

  @Post()
  async createNotice(@Body() dto: CreateNoticeDto): Promise<NoticeResponse> {
    return this.contentService.createNotice(dto);
  }

  @Patch(':id')
  async updateNotice(
    @Param('id') id: string,
    @Body() dto: UpdateNoticeDto,
  ): Promise<NoticeResponse> {
    return this.contentService.updateNotice(id, dto);
  }

  @Delete(':id')
  async deleteNotice(@Param('id') id: string): Promise<{ message: string }> {
    return this.contentService.deleteNotice(id);
  }
}
