import { Banner, Announcement, LiveStream, Notice } from '@prisma/client';

export interface BannerResponse {
  id: string;
  tagline: string | null;
  title: string | null;
  subtitle: string | null;
  brand_badge: string | null;
  brandBadge?: string | null;
  image_url: string;
  imageUrl?: string;
  button_text: string | null;
  buttonText?: string | null;
  target_tab_index: number;
  targetTabIndex?: number;
  link_url: string | null;
  linkUrl?: string | null;
  sort_order: number;
  sortOrder?: number;
  order: number;
  is_active: boolean;
  isActive?: boolean;
  starts_at: Date | null;
  startsAt?: Date | null;
  ends_at: Date | null;
  endsAt?: Date | null;
  created_at: Date;
  createdAt?: Date;
  updated_at: Date;
  updatedAt?: Date;
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
  viewerCount?: string;
  is_live: boolean;
  isLive?: boolean;
  is_official: boolean;
  isOfficial?: boolean;
  image_url: string;
  imageUrl?: string;
  stream_url: string;
  streamUrl?: string;
  cta_text: string;
  ctaText?: string;
}

export interface BrandPartnerResponse {
  id: string;
  name: string;
  logo_url: string;
  logoUrl?: string;
}

export const toBannerResponse = (banner: Banner): BannerResponse => ({
  id: banner.id,
  tagline: banner.tagline,
  title: banner.title,
  subtitle: banner.subtitle,
  brand_badge: banner.brandBadge,
  brandBadge: banner.brandBadge,
  image_url: banner.imageUrl,
  imageUrl: banner.imageUrl,
  button_text: banner.buttonText,
  buttonText: banner.buttonText,
  target_tab_index: banner.targetTabIndex,
  targetTabIndex: banner.targetTabIndex,
  link_url: banner.linkUrl,
  linkUrl: banner.linkUrl,
  sort_order: banner.sortOrder,
  sortOrder: banner.sortOrder,
  order: banner.sortOrder,
  is_active: banner.isActive,
  isActive: banner.isActive,
  starts_at: banner.startsAt,
  startsAt: banner.startsAt,
  ends_at: banner.endsAt,
  endsAt: banner.endsAt,
  created_at: banner.createdAt,
  createdAt: banner.createdAt,
  updated_at: banner.updatedAt,
  updatedAt: banner.updatedAt,
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
  viewerCount: stream.viewerCount,
  is_live: stream.isLive,
  isLive: stream.isLive,
  is_official: stream.isOfficial,
  isOfficial: stream.isOfficial,
  image_url: stream.imageUrl,
  imageUrl: stream.imageUrl,
  stream_url: stream.streamUrl,
  streamUrl: stream.streamUrl,
  cta_text: stream.ctaText,
  ctaText: stream.ctaText,
});

export const toBrandPartnerResponse = (partner: {
  id: string;
  name: string;
  logoUrl: string;
}): BrandPartnerResponse => ({
  id: partner.id,
  name: partner.name,
  logo_url: partner.logoUrl,
  logoUrl: partner.logoUrl,
});

