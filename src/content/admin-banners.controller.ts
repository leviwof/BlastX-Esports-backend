import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ContentService } from './content.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';
import { ListContentQuery } from './dto/list-content.query';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { BannerResponse } from './content.mapper';
import { PaginatedResult } from '../common/pagination.dto';

@Controller('admin/banners')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBannersController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  async listBanners(@Query() query: ListContentQuery): Promise<PaginatedResult<BannerResponse>> {
    return this.contentService.listBanners(query);
  }

  @Get(':id')
  async getBanner(@Param('id') id: string): Promise<BannerResponse> {
    return this.contentService.getBanner(id);
  }

  @Post()
  async createBanner(@Body() dto: CreateBannerDto): Promise<BannerResponse> {
    return this.contentService.createBanner(dto);
  }

  @Patch(':id')
  async updateBanner(
    @Param('id') id: string,
    @Body() dto: UpdateBannerDto,
  ): Promise<BannerResponse> {
    return this.contentService.updateBanner(id, dto);
  }

  @Delete(':id')
  async deleteBanner(@Param('id') id: string): Promise<{ message: string }> {
    return this.contentService.deleteBanner(id);
  }
}
