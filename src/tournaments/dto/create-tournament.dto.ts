import { IsNotEmpty, IsOptional, IsString, IsEnum, IsInt, Min, IsUrl, IsDateString, IsObject } from 'class-validator';
import { TournamentFormat, TeamMode } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateTournamentDto {
  @IsOptional()
  @IsString()
  game_slug?: string = 'free_fire';

  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  banner_url?: string;

  @IsNotEmpty()
  @IsEnum(TournamentFormat)
  format!: TournamentFormat;

  @IsNotEmpty()
  @IsEnum(TeamMode)
  team_mode!: TeamMode;

  @IsNotEmpty()
  @IsString()
  map!: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_slots!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  entry_fee?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  prize_pool?: number = 0;

  @IsOptional()
  prize_distribution?: any;

  @IsOptional()
  rules?: any;

  @IsNotEmpty()
  @IsDateString()
  registration_opens_at!: string;

  @IsNotEmpty()
  @IsDateString()
  registration_closes_at!: string;

  @IsNotEmpty()
  @IsDateString()
  starts_at!: string;
}
