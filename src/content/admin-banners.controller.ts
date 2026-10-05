import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContentService, UploadedImageFile } from './content.service';
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
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async createBanner(
    @Body() dto: CreateBannerDto,
    @UploadedFile() file?: UploadedImageFile,
  ): Promise<
    | BannerResponse
    | {
        status: 'success';
        message: string;
        data: { id: string; image_url: string };
      }
  > {
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        throw new BadRequestException('Banner images must be JPEG, PNG or WebP');
      }
      const { image_url } = await this.contentService.uploadImage(file);
      const banner = await this.contentService.createBanner({
        ...dto,
        image_url,
      });
      return {
        status: 'success',
        message: 'Banner created and published successfully',
        data: { id: banner.id, image_url: banner.image_url },
      };
    }
    if (!dto.image_url) {
      throw new BadRequestException('Upload an image');
    }
    return this.contentService.createBanner(dto);
  }

  @Patch(':id')
  async updateBanner(@Param('id') id: string, @Body() dto: UpdateBannerDto): Promise<BannerResponse> {
    return this.contentService.updateBanner(id, dto);
  }

  @Delete(':id')
  async deleteBanner(@Param('id') id: string): Promise<{ message: string }> {
    return this.contentService.deleteBanner(id);
  }
}
