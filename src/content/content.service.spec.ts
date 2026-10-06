import { BadRequestException } from '@nestjs/common';
import { ContentService } from './content.service';

describe('ContentService image uploads', () => {
  let service: ContentService;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SECRET_KEY;
  const originalSupabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalGoogleRefreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const originalGoogleClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const originalGoogleClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const originalGoogleFolderId = process.env.GOOGLE_DRIVE_IMAGES_FOLDER_ID;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRailwayEnvironment = process.env.RAILWAY_ENVIRONMENT;
  const originalRailwayProjectId = process.env.RAILWAY_PROJECT_ID;

  beforeEach(() => {
    service = new ContentService({} as never);
    process.env.SUPABASE_URL = 'https://storage.example.com';
    process.env.SUPABASE_SECRET_KEY = 'test-secret';
    delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    delete process.env.GOOGLE_DRIVE_IMAGES_FOLDER_ID;
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.RAILWAY_PROJECT_ID;
    process.env.NODE_ENV = 'test';
  });

  describe('ContentService home content', () => {
    it('returns only currently active banners in configured order', async () => {
      const banner = {
        id: 'banner_1',
        tagline: 'TAGLINE',
        title: 'BGC 2026',
        subtitle: 'Bigger battles',
        brandBadge: 'COMMUNITY',
        imageUrl: 'https://example.com/banner.png',
        buttonText: 'Know more',
        targetTabIndex: 1,
        linkUrl: null,
        sortOrder: 2,
        isActive: true,
        startsAt: null,
        endsAt: null,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date('2026-10-01T00:00:00Z'),
      };
      const prisma = {
        banner: { findMany: jest.fn().mockResolvedValue([banner]) },
      };
      const service = new ContentService(prisma as never);

      await expect(service.listHomeBanners()).resolves.toEqual([
        {
          id: 'banner_1',
          tagline: 'TAGLINE',
          title: 'BGC 2026',
          subtitle: 'Bigger battles',
          brand_badge: 'COMMUNITY',
          image_url: 'https://example.com/banner.png',
          button_text: 'Know more',
          target_tab_index: 1,
          link_url: null,
          sort_order: 2,
          order: 2,
          is_active: true,
          starts_at: null,
          ends_at: null,
          created_at: banner.createdAt,
          updated_at: banner.updatedAt,
        },
      ]);
      expect(prisma.banner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('serializes stored live streams in the home app contract', async () => {
      const prisma = {
        liveStream: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'stream_1',
              title: 'PRO SERIES',
              subtitle: 'Grand Finals',
              location: 'New Delhi, India',
              viewerCount: '12.4K',
              isLive: true,
              isOfficial: true,
              imageUrl: 'https://example.com/stream.png',
              streamUrl: 'https://youtube.com/live/abc',
              ctaText: 'Watch Now →',
            },
          ]),
        },
      };
      const service = new ContentService(prisma as never);

      await expect(service.listLiveStreams()).resolves.toEqual([
        {
          id: 'stream_1',
          title: 'PRO SERIES',
          subtitle: 'Grand Finals',
          location: 'New Delhi, India',
          viewer_count: '12.4K',
          is_live: true,
          is_official: true,
          image_url: 'https://example.com/stream.png',
          stream_url: 'https://youtube.com/live/abc',
          cta_text: 'Watch Now →',
        },
      ]);
    });

    it('returns active brand partners in configured order using the app contract', async () => {
      const partners = [
        { id: 'partner_1', name: 'Red Bull Gaming', logoUrl: 'https://example.com/redbull.png' },
      ];
      const prisma = {
        brandPartner: { findMany: jest.fn().mockResolvedValue(partners) },
      };
      const service = new ContentService(prisma as never);

      await expect(service.listHomePartners()).resolves.toEqual([
        { id: 'partner_1', name: 'Red Bull Gaming', logo_url: 'https://example.com/redbull.png' },
      ]);
      expect(prisma.brandPartner.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, logoUrl: true },
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSupabaseKey;
    if (originalSupabasePublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalSupabasePublishableKey;
    if (originalGoogleRefreshToken === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    else process.env.GOOGLE_DRIVE_REFRESH_TOKEN = originalGoogleRefreshToken;
    if (originalGoogleClientId === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    else process.env.GOOGLE_DRIVE_CLIENT_ID = originalGoogleClientId;
    if (originalGoogleClientSecret === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    else process.env.GOOGLE_DRIVE_CLIENT_SECRET = originalGoogleClientSecret;
    if (originalGoogleFolderId === undefined) delete process.env.GOOGLE_DRIVE_IMAGES_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_IMAGES_FOLDER_ID = originalGoogleFolderId;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalRailwayEnvironment === undefined) delete process.env.RAILWAY_ENVIRONMENT;
    else process.env.RAILWAY_ENVIRONMENT = originalRailwayEnvironment;
    if (originalRailwayProjectId === undefined) delete process.env.RAILWAY_PROJECT_ID;
    else process.env.RAILWAY_PROJECT_ID = originalRailwayProjectId;
  });

  it('stores supported images in the public storage bucket and returns the URL', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await service.uploadImage({
      mimetype: 'image/png',
      size: pngHeader.length,
      buffer: pngHeader,
    });

    expect(result.image_url).toMatch(/^https:\/\/storage\.example\.com\/storage\/v1\/object\/public\/proofs\/admin-images\/.+\.png$/);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/storage\/v1\/object\/proofs\/admin-images\/.+\.png$/),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
      }),
    );
  });

  it('uses the configured Google Drive storage for admin images', async () => {
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN = 'refresh-token';
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'client-secret';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token' }))
      .mockResolvedValueOnce(Response.json({ id: 'image-file-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await service.uploadImage({
      mimetype: 'image/png',
      size: pngHeader.length,
      buffer: pngHeader,
    });

    expect(result.image_url).toBe('https://drive.google.com/thumbnail?id=image-file-id&sz=w1600');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://www.googleapis.com/drive/v3/files/image-file-id/permissions?supportsAllDrives=true',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }),
    );
  });

  it('rejects unsupported image content', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      service.uploadImage({
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from('nope'),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects images larger than 8 MB', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      service.uploadImage({
        mimetype: 'image/png',
        size: 8 * 1024 * 1024 + 1,
        buffer: Buffer.alloc(0),
      }),
    ).rejects.toThrow('Image must be 8 MB or smaller');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fall back to local disk on Railway when remote storage is unconfigured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.NODE_ENV = 'development';
    process.env.RAILWAY_ENVIRONMENT = 'production';
    const fetchMock = jest.spyOn(global, 'fetch');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await expect(
      service.uploadImage({
        mimetype: 'image/png',
        size: pngHeader.length,
        buffer: pngHeader,
      }),
    ).rejects.toThrow('Image storage is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
