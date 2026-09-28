import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ChallengeType } from '@prisma/client';

export class UpdateChallengeDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reward_xp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  target_progress?: number;

  @IsOptional()
  @IsString()
  game?: string;

  @IsOptional()
  @IsEnum(ChallengeType)
  type?: ChallengeType;

  @IsOptional()
  @IsBoolean()
  requires_recording?: boolean;

  @IsOptional()
  @IsString()
  game_package?: string;

  @IsOptional()
  @IsString()
  icon_asset?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
