import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ChallengeType } from '@prisma/client';

export class CreateChallengeDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  reward_xp: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  target_progress?: number = 1.0;

  @IsOptional()
  @IsString()
  game?: string = 'Free Fire';

  @IsOptional()
  @IsEnum(ChallengeType)
  type?: ChallengeType = ChallengeType.DAILY;

  @IsOptional()
  @IsBoolean()
  requires_recording?: boolean = true;

  @IsOptional()
  @IsString()
  game_package?: string = 'com.dts.freefireth';

  @IsOptional()
  @IsString()
  icon_asset?: string;
}
