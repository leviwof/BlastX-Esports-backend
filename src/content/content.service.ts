import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
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
import { CreateLiveStreamDto } from './dto/create-live-stream.dto';
import { UpdateLiveStreamDto } from './dto/update-live-stream.dto';
import { ListContentQuery } from './dto/list-content.query';
import {
  BannerResponse,
  AnnouncementResponse,
  NoticeResponse,
  LiveStreamResponse,
  toBannerResponse,
  toAnnouncementResponse,
  toNoticeResponse,
  toLiveStreamResponse,
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
    const driveClientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_IDS?.split(',')[0];
    const googleDriveConfigured = Boolean(
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN && driveClientId && process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    );

    const driveUrl = await this.uploadImageToGoogleDrive(filename, image.mimeType, file.buffer);
    if (driveUrl) {
      return { image_url: driveUrl };
    }

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
        const details = await response.text();
        this.logger.error(`Image storage rejected upload with status ${response.status}: ${details}`);
        throw new BadGatewayException('Image upload failed. Please try again.');
      }

      return {
        image_url: `${supabaseUrl}/storage/v1/object/public/proofs/${objectPath}`,
      };
    }

    const isHostedDeployment =
      process.env.NODE_ENV === 'production' ||
      Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
    if (isHostedDeployment) {
      if (googleDriveConfigured) {
        throw new BadGatewayException('Image storage is unavailable. Please try again later.');
      }
      throw new ServiceUnavailableException(
        'Image storage is not configured. Set up Google Drive or Supabase storage for production uploads.',
      );
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

  private async uploadImageToGoogleDrive(
    filename: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<string | null> {
    const clean = (value?: string) => value?.trim().replace(/^["']|["']$/g, '') || '';
    const refreshToken = clean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN);
    const clientId = clean(process.env.GOOGLE_DRIVE_CLIENT_ID) || clean(process.env.GOOGLE_CLIENT_IDS?.split(',')[0]);
    const clientSecret = clean(process.env.GOOGLE_DRIVE_CLIENT_SECRET);
    if (!refreshToken || !clientId || !clientSecret) {
      return null;
    }

    let uploadedFileId: string | null = null;
    let accessToken: string | undefined;
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (!tokenResponse.ok) {
        this.logger.error(`Google Drive token exchange failed with status ${tokenResponse.status}`);
        return null;
      }

      ({ access_token: accessToken } = (await tokenResponse.json()) as { access_token: string });
      const boundary = `blastix-image-${randomUUID()}`;
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;
      const metadata: Record<string, string | string[]> = {
        name: filename,
        mimeType,
        description: 'BlastiX admin content image',
      };
      const folderId = clean(process.env.GOOGLE_DRIVE_IMAGES_FOLDER_ID) || clean(process.env.GOOGLE_DRIVE_FOLDER_ID);
      if (folderId) metadata.parents = [folderId];

      const body = Buffer.concat([
        Buffer.from(
          `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}${delimiter}Content-Type: ${mimeType}\r\n\r\n`,
        ),
        buffer,
        Buffer.from(closeDelimiter),
      ]);
      const uploadResponse = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
            'Content-Length': String(body.length),
          },
          body: new Uint8Array(body),
        },
      );
      if (!uploadResponse.ok) {
        const details = await uploadResponse.text();
        this.logger.error(`Google Drive image upload failed with status ${uploadResponse.status}: ${details}`);
        return null;
      }

      const { id } = (await uploadResponse.json()) as { id: string };
      uploadedFileId = id;
      const permissionResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });
      if (!permissionResponse.ok) {
        const details = await permissionResponse.text();
        this.logger.error(`Google Drive image permission setup failed with status ${permissionResponse.status}: ${details}`);
        await this.deleteGoogleDriveImage(id, accessToken);
        return null;
      }
      return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
    } catch (error) {
      this.logger.error(`Google Drive image upload failed: ${error instanceof Error ? error.message : String(error)}`);
      if (uploadedFileId && accessToken) {
        await this.deleteGoogleDriveImage(uploadedFileId, accessToken);
      }
      return null;
    }
  }

  private async deleteGoogleDriveImage(fileId: string, accessToken: string): Promise<void> {
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        this.logger.error(`Could not remove incomplete Google Drive image ${fileId}: status ${response.status}`);
      }
    } catch (error) {
      this.logger.error(`Could not remove incomplete Google Drive image ${fileId}: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  async listHomeBanners(): Promise<BannerResponse[]> {
    const now = new Date();
    const banners = await this.prisma.banner.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return banners.map(toBannerResponse);
  }

  async getBanner(id: string): Promise<BannerResponse> {
    const banner = await this.prisma.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException(`Banner with ID '${id}' not found`);
    return toBannerResponse(banner);
  }

  async createBanner(dto: CreateBannerDto): Promise<BannerResponse> {
    const imageUrl = dto.image_url?.trim();
    if (!imageUrl) {
      throw new BadRequestException('Upload an image or provide image_url');
    }
    const banner = await this.prisma.banner.create({
      data: {
        tagline: dto.tagline?.trim() || null,
        title: dto.title,
        subtitle: dto.subtitle?.trim() || null,
        brandBadge: dto.brand_badge?.trim() || null,
        imageUrl,
        buttonText: dto.button_text?.trim() || null,
        targetTabIndex: dto.target_tab_index ?? 1,
        linkUrl: dto.link_url ?? null,
        sortOrder: dto.order ?? dto.sort_order ?? 0,
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
    if (dto.tagline !== undefined) data.tagline = dto.tagline.trim() || null;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle.trim() || null;
    if (dto.brand_badge !== undefined) data.brandBadge = dto.brand_badge.trim() || null;
    if (dto.image_url !== undefined) data.imageUrl = dto.image_url;
    if (dto.button_text !== undefined) data.buttonText = dto.button_text.trim() || null;
    if (dto.target_tab_index !== undefined) data.targetTabIndex = dto.target_tab_index;
    if (dto.link_url !== undefined) data.linkUrl = dto.link_url;
    if (dto.sort_order !== undefined) data.sortOrder = dto.sort_order;
    if (dto.order !== undefined) data.sortOrder = dto.order;
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

  async listLiveStreams(): Promise<LiveStreamResponse[]> {
    const streams = await this.prisma.liveStream.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return streams.map(toLiveStreamResponse);
  }

  async createLiveStream(dto: CreateLiveStreamDto): Promise<LiveStreamResponse> {
    const stream = await this.prisma.liveStream.create({
      data: {
        title: dto.title.trim(),
        subtitle: dto.subtitle.trim(),
        location: dto.location.trim(),
        viewerCount: dto.viewer_count?.trim() || '0',
        isLive: dto.is_live ?? false,
        isOfficial: dto.is_official ?? false,
        imageUrl: dto.image_url,
        streamUrl: dto.stream_url,
        sortOrder: dto.order ?? 0,
      },
    });
    return toLiveStreamResponse(stream);
  }

  async updateLiveStream(id: string, dto: UpdateLiveStreamDto): Promise<LiveStreamResponse> {
    const existing = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Live stream with ID '${id}' not found`);

    const data: Prisma.LiveStreamUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle.trim();
    if (dto.location !== undefined) data.location = dto.location.trim();
    if (dto.viewer_count !== undefined) data.viewerCount = dto.viewer_count.trim();
    if (dto.is_live !== undefined) data.isLive = dto.is_live;
    if (dto.is_official !== undefined) data.isOfficial = dto.is_official;
    if (dto.image_url !== undefined) data.imageUrl = dto.image_url;
    if (dto.stream_url !== undefined) data.streamUrl = dto.stream_url;
    if (dto.order !== undefined) data.sortOrder = dto.order;

    const stream = await this.prisma.liveStream.update({ where: { id }, data });
    return toLiveStreamResponse(stream);
  }

  async deleteLiveStream(id: string): Promise<{ message: string }> {
    const existing = await this.prisma.liveStream.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Live stream with ID '${id}' not found`);
    await this.prisma.liveStream.delete({ where: { id } });
    return { message: 'Live stream deleted successfully' };
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
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
    });
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
