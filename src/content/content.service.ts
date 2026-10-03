import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, NoticeSeverity } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { UpdateNoticeDto } from './dto/update-notice.dto';
import { ListContentQuery } from './dto/list-content.query';
import {
  BannerResponse,
  AnnouncementResponse,
  NoticeResponse,
  toBannerResponse,
  toAnnouncementResponse,
  toNoticeResponse,
} from './content.mapper';
import { createPaginatedResponse, PaginatedResult } from '../common/pagination.dto';

export interface UploadedImageFile {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async uploadImage(file?: UploadedImageFile): Promise<{ image_url: string }> {
    if (!file) {
      throw new BadRequestException('Select an image to upload');
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new BadRequestException('Image must be 8 MB or smaller');
    }

    const image = this.detectImageType(file.buffer);
    if (!image || image.mimeType !== file.mimetype) {
      throw new BadRequestException('Invalid image file. Upload a JPEG, PNG, GIF or WebP image');
    }

    const filename = `${randomUUID()}.${image.extension}`;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const objectPath = `admin-images/${filename}`;
      let response: Response;
      try {
        response = await fetch(`${supabaseUrl}/storage/v1/object/proofs/${objectPath}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
            'Content-Type': image.mimeType,
            'x-upsert': 'true',
          },
          body: new Uint8Array(file.buffer),
        });
      } catch (error) {
        this.logger.error(`Image storage request failed: ${error instanceof Error ? error.message : String(error)}`);
        throw new BadGatewayException('Image upload failed. Please try again.');
      }

      if (!response.ok) {
        this.logger.error(`Image storage rejected upload with status ${response.status}`);
        throw new BadGatewayException('Image upload failed. Please try again.');
      }

      return {
        image_url: `${supabaseUrl}/storage/v1/object/public/proofs/${objectPath}`,
      };
    }

    const uploadsDir = path.join(process.cwd(), 'uploads', 'admin-images');
    try {
      await mkdir(uploadsDir, { recursive: true });
      await writeFile(path.join(uploadsDir, filename), file.buffer);
    } catch (error) {
      this.logger.error(`Local image storage failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new InternalServerErrorException('Image upload failed. Please try again.');
    }

    const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return { image_url: `${baseUrl}/uploads/admin-images/${filename}` };
  }

  private detectImageType(buffer: Buffer): { mimeType: string; extension: string } | null {
    if (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return { mimeType: 'image/png', extension: 'png' };
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: 'image/jpeg', extension: 'jpg' };
    }
    if (
      buffer.length >= 6 &&
      (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
    ) {
      return { mimeType: 'image/gif', extension: 'gif' };
    }
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { mimeType: 'image/webp', extension: 'webp' };
    }
    return null;
  }

  // ---------------- BANNERS ----------------
  async listBanners(query: ListContentQuery): Promise<PaginatedResult<BannerResponse>> {
    const where: Prisma.BannerWhereInput = {};
    if (typeof query.is_active === 'boolean') {
      where.isActive = query.is_active;
    }

    const [total, banners] = await Promise.all([
      this.prisma.banner.count({ where }),
      this.prisma.banner.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    return createPaginatedResponse(banners.map(toBannerResponse), query.page ?? 1, query.limit ?? 20, total);
  }

  async getBanner(id: string): Promise<BannerResponse> {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException(`Banner with ID '${id}' not found`);
    return toBannerResponse(banner);
  }

  async createBanner(dto: CreateBannerDto): Promise<BannerResponse> {
    const banner = await this.prisma.banner.create({
      data: {
        title: dto.title,
        imageUrl: dto.image_url,
        linkUrl: dto.link_url ?? null,
        sortOrder: dto.sort_order ?? 0,
        isActive: dto.is_active ?? true,
        startsAt: dto.starts_at ? new Date(dto.starts_at) : null,
        endsAt: dto.ends_at ? new Date(dto.ends_at) : null,
      },
    });
    return toBannerResponse(banner);
  }

  async updateBanner(id: string, dto: UpdateBannerDto): Promise<BannerResponse> {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Banner with ID '${id}' not found`);

    const data: Prisma.BannerUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.image_url !== undefined) data.imageUrl = dto.image_url;
    if (dto.link_url !== undefined) data.linkUrl = dto.link_url;
    if (dto.sort_order !== undefined) data.sortOrder = dto.sort_order;
    if (dto.is_active !== undefined) data.isActive = dto.is_active;
    if (dto.starts_at !== undefined) data.startsAt = dto.starts_at ? new Date(dto.starts_at) : null;
    if (dto.ends_at !== undefined) data.endsAt = dto.ends_at ? new Date(dto.ends_at) : null;

    const updated = await this.prisma.banner.update({ where: { id }, data });
    return toBannerResponse(updated);
  }

  async deleteBanner(id: string): Promise<{ message: string }> {
    const existing = await this.prisma.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Banner with ID '${id}' not found`);

    await this.prisma.banner.delete({ where: { id } });
    return { message: 'Banner deleted successfully' };
  }

  // ---------------- ANNOUNCEMENTS ----------------
  async listAnnouncements(query: ListContentQuery): Promise<PaginatedResult<AnnouncementResponse>> {
    const where: Prisma.AnnouncementWhereInput = {};
    if (typeof query.is_published === 'boolean') {
      where.isPublished = query.is_published;
    } else if (typeof query.is_active === 'boolean') {
      where.isPublished = query.is_active;
    }

    const [total, announcements] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return createPaginatedResponse(announcements.map(toAnnouncementResponse), query.page ?? 1, query.limit ?? 20, total);
  }

  async getAnnouncement(id: string): Promise<AnnouncementResponse> {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException(`Announcement with ID '${id}' not found`);
    return toAnnouncementResponse(announcement);
  }

  async createAnnouncement(dto: CreateAnnouncementDto): Promise<AnnouncementResponse> {
    const isPublished = dto.is_published ?? true;
    const announcement = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        isPublished,
        publishedAt: isPublished ? new Date() : null,
      },
    });
    return toAnnouncementResponse(announcement);
  }

  async updateAnnouncement(id: string, dto: UpdateAnnouncementDto): Promise<AnnouncementResponse> {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Announcement with ID '${id}' not found`);

    const data: Prisma.AnnouncementUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.is_published !== undefined) {
      data.isPublished = dto.is_published;
      if (dto.is_published && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
    }

    const updated = await this.prisma.announcement.update({ where: { id }, data });
    return toAnnouncementResponse(updated);
  }

  async deleteAnnouncement(id: string): Promise<{ message: string }> {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Announcement with ID '${id}' not found`);

    await this.prisma.announcement.delete({ where: { id } });
    return { message: 'Announcement deleted successfully' };
  }

  // ---------------- NOTICES ----------------
  async listNotices(query: ListContentQuery): Promise<PaginatedResult<NoticeResponse>> {
    const where: Prisma.NoticeWhereInput = {};
    if (typeof query.is_active === 'boolean') {
      where.isActive = query.is_active;
    }

    const [total, notices] = await Promise.all([
      this.prisma.notice.count({ where }),
      this.prisma.notice.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return createPaginatedResponse(notices.map(toNoticeResponse), query.page ?? 1, query.limit ?? 20, total);
  }

  async getNotice(id: string): Promise<NoticeResponse> {
    const notice = await this.prisma.notice.findUnique({ where: { id } });
    if (!notice) throw new NotFoundException(`Notice with ID '${id}' not found`);
    return toNoticeResponse(notice);
  }

  async createNotice(dto: CreateNoticeDto): Promise<NoticeResponse> {
    const notice = await this.prisma.notice.create({
      data: {
        title: dto.title,
        body: dto.body,
        severity: dto.severity ?? NoticeSeverity.INFO,
        isActive: dto.is_active ?? true,
      },
    });
    return toNoticeResponse(notice);
  }

  async updateNotice(id: string, dto: UpdateNoticeDto): Promise<NoticeResponse> {
    const existing = await this.prisma.notice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Notice with ID '${id}' not found`);

    const data: Prisma.NoticeUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.severity !== undefined) data.severity = dto.severity;
    if (dto.is_active !== undefined) data.isActive = dto.is_active;

    const updated = await this.prisma.notice.update({ where: { id }, data });
    return toNoticeResponse(updated);
  }

  async deleteNotice(id: string): Promise<{ message: string }> {
    const existing = await this.prisma.notice.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Notice with ID '${id}' not found`);

    await this.prisma.notice.delete({ where: { id } });
    return { message: 'Notice deleted successfully' };
  }
}
