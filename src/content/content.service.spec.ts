import { BadRequestException } from '@nestjs/common';
import { ContentService } from './content.service';

describe('ContentService image uploads', () => {
  let service: ContentService;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SECRET_KEY;
  const originalGoogleRefreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const originalGoogleClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const originalGoogleClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const originalGoogleFolderId = process.env.GOOGLE_DRIVE_IMAGES_FOLDER_ID;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    service = new ContentService({} as never);
    process.env.SUPABASE_URL = 'https://storage.example.com';
    process.env.SUPABASE_SECRET_KEY = 'test-secret';
    delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    delete process.env.GOOGLE_DRIVE_IMAGES_FOLDER_ID;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSupabaseKey;
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
  });

  it('stores supported images in the public storage bucket and returns the URL', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await service.uploadImage({
      mimetype: 'image/png',
      size: pngHeader.length,
      buffer: pngHeader,
    });

    expect(result.image_url).toMatch(
      /^https:\/\/storage\.example\.com\/storage\/v1\/object\/public\/proofs\/admin-images\/.+\.png$/,
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/storage\/v1\/object\/proofs\/admin-images\/.+\.png$/),
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Content-Type': 'image/png' }) }),
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
});
