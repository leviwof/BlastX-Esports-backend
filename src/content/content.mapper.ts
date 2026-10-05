import { Banner, Announcement, LiveStream, Notice } from '@prisma/client';

export interface BannerResponse {
  id: string;
  tagline: string | null;
  title: string;
  subtitle: string | null;
  brand_badge: string | null;
  image_url: string;
  button_text: string | null;
  target_tab_index: number;
  link_url: string | null;
  sort_order: number;
  order: number;
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

export interface LiveStreamResponse {
  id: string;
  title: string;
  subtitle: string;
  location: string;
  viewer_count: string;
  is_live: boolean;
  is_official: boolean;
  image_url: string;
  stream_url: string;
}

export const toBannerResponse = (banner: Banner): BannerResponse => ({
  id: banner.id,
  tagline: banner.tagline,
  title: banner.title,
  subtitle: banner.subtitle,
  brand_badge: banner.brandBadge,
  image_url: banner.imageUrl,
  button_text: banner.buttonText,
  target_tab_index: banner.targetTabIndex,
  link_url: banner.linkUrl,
  sort_order: banner.sortOrder,
  order: banner.sortOrder,
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

export const toLiveStreamResponse = (stream: LiveStream): LiveStreamResponse => ({
  id: stream.id,
  title: stream.title,
  subtitle: stream.subtitle,
  location: stream.location,
  viewer_count: stream.viewerCount,
  is_live: stream.isLive,
  is_official: stream.isOfficial,
  image_url: stream.imageUrl,
  stream_url: stream.streamUrl,
});
