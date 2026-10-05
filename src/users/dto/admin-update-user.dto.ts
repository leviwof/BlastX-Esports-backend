import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_vip?: boolean;

  @IsOptional()
  @IsBoolean()
  crown_badge_unlocked?: boolean;

  @IsOptional()
  @IsIn(['PLAYER', 'ADMIN'])
  role?: 'PLAYER' | 'ADMIN';
}
