import { Controller, Get, Query } from '@nestjs/common';
import { ContentService } from './content.service';
import { ListContentQuery } from './dto/list-content.query';
import { BannerResponse, AnnouncementResponse, NoticeResponse } from './content.mapper';
import { PaginatedResult } from '../common/pagination.dto';
import { Public } from '../common/public.decorator';

@Controller()
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Public()
  @Get('home/banners')
  async getHomeBanners() {
    const banners = await this.contentService.listHomeBanners();
    return {
      success: true,
      banners,
    };
  }

  @Public()
  @Get('home/live-streams')
  async getHomeLiveStreams() {
    const streams = await this.contentService.listLiveStreams();
    return {
      success: true,
      streams,
    };
  }

  @Public()
  @Get('home/partners')
  async getHomePartners() {
    const partners = await this.contentService.listHomePartners();
    return {
      success: true,
      partners,
    };
  }

  @Get('banners')
  async getPublicBanners(@Query() query: ListContentQuery): Promise<PaginatedResult<BannerResponse>> {
    if (query.is_active === undefined) {
      query.is_active = true;
    }
    return this.contentService.listBanners(query);
  }

  @Get('announcements')
  async getPublicAnnouncements(@Query() query: ListContentQuery): Promise<PaginatedResult<AnnouncementResponse>> {
    if (query.is_published === undefined) {
      query.is_published = true;
    }
    return this.contentService.listAnnouncements(query);
  }

  @Get('notices')
  async getPublicNotices(@Query() query: ListContentQuery): Promise<PaginatedResult<NoticeResponse>> {
    if (query.is_active === undefined) {
      query.is_active = true;
    }
    return this.contentService.listNotices(query);
  }
}
