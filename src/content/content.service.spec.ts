import { BadRequestException } from '@nestjs/common';
import { ContentService } from './content.service';

describe('ContentService image uploads', () => {
  let service: ContentService;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SECRET_KEY;

  beforeEach(() => {
    service = new ContentService({} as never);
    process.env.SUPABASE_URL = 'https://storage.example.com';
    process.env.SUPABASE_SECRET_KEY = 'test-secret';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalSupabaseKey;
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
