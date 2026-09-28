import { Banner, Announcement, Notice } from '@prisma/client';

export interface BannerResponse {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnnouncementResponse {
  id: string;
  title: string;
  body: string;
  is_published: boolean;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NoticeResponse {
  id: string;
  title: string;
  body: string;
  severity: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export const toBannerResponse = (banner: Banner): BannerResponse => ({
  id: banner.id,
  title: banner.title,
  image_url: banner.imageUrl,
  link_url: banner.linkUrl,
  sort_order: banner.sortOrder,
  is_active: banner.isActive,
  starts_at: banner.startsAt,
  ends_at: banner.endsAt,
  created_at: banner.createdAt,
  updated_at: banner.updatedAt,
});

export const toAnnouncementResponse = (announcement: Announcement): AnnouncementResponse => ({
  id: announcement.id,
  title: announcement.title,
  body: announcement.body,
  is_published: announcement.isPublished,
  published_at: announcement.publishedAt,
  created_at: announcement.createdAt,
  updated_at: announcement.updatedAt,
});

export const toNoticeResponse = (notice: Notice): NoticeResponse => ({
  id: notice.id,
  title: notice.title,
  body: notice.body,
  severity: notice.severity,
  is_active: notice.isActive,
  created_at: notice.createdAt,
  updated_at: notice.updatedAt,
});
