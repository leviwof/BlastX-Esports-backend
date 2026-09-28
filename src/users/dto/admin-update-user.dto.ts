import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsIn(['PLAYER', 'ADMIN'])
  role?: 'PLAYER' | 'ADMIN';
}
