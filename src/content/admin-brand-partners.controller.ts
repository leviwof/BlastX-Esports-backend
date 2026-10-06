import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ContentService, UploadedImageFile } from './content.service';
import { CreateBrandPartnerDto } from './dto/create-brand-partner.dto';
import { UpdateBrandPartnerDto } from './dto/update-brand-partner.dto';

@Controller('admin/partners')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBrandPartnersController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  listBrandPartners() {
    return this.contentService.listBrandPartners();
  }

  @Post()
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async createBrandPartner(
    @Body() dto: CreateBrandPartnerDto,
    @UploadedFile() file?: UploadedImageFile,
  ) {
    let logoUrl: string | undefined;
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        throw new BadRequestException('Partner logos must be JPEG, PNG or WebP');
      }
      ({ image_url: logoUrl } = await this.contentService.uploadImage(file));
    }
    return this.contentService.createBrandPartner(dto, logoUrl);
  }

  @Patch(':id')
  updateBrandPartner(@Param('id') id: string, @Body() dto: UpdateBrandPartnerDto) {
    return this.contentService.updateBrandPartner(id, dto);
  }

  @Delete(':id')
  deleteBrandPartner(@Param('id') id: string) {
    return this.contentService.deleteBrandPartner(id);
  }
}
