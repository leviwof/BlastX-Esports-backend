import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBannerDto } from './create-banner.dto';

describe('CreateBannerDto', () => {
  it.each([
    ['true', true],
    ['false', false],
    [true, true],
    [false, false],
  ])('transforms %p into %p', async (input, expected) => {
    const dto = plainToInstance(CreateBannerDto, { title: 'BGC 2026', is_active: input });

    expect(dto.is_active).toBe(expected);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid boolean strings', async () => {
    const dto = plainToInstance(CreateBannerDto, { title: 'BGC 2026', is_active: 'yes' });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'is_active' })]),
    );
  });
});
