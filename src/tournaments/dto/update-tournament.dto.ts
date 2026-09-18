import { IsOptional, IsString, IsEnum, IsInt, Min, IsUrl, IsDateString } from 'class-validator';
import { TournamentFormat, TeamMode } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdateTournamentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  banner_url?: string;

  @IsOptional()
  @IsEnum(TournamentFormat)
  format?: TournamentFormat;

  @IsOptional()
  @IsEnum(TeamMode)
  team_mode?: TeamMode;

  @IsOptional()
  @IsString()
  map?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_slots?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  entry_fee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  prize_pool?: number;

  @IsOptional()
  prize_distribution?: any;

  @IsOptional()
  rules?: any;

  @IsOptional()
  @IsDateString()
  registration_opens_at?: string;

  @IsOptional()
  @IsDateString()
  registration_closes_at?: string;

  @IsOptional()
  @IsDateString()
  starts_at?: string;
}
