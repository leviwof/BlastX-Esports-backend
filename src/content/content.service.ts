import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, NoticeSeverity } from '@prisma/client';
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

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

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
