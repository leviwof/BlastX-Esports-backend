import { IsOptional, IsEnum, IsString, IsDateString } from 'class-validator';
import { TournamentStatus, TeamMode, TournamentFormat } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination.dto';

export class FilterTournamentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TournamentStatus)
  status?: TournamentStatus;

  @IsOptional()
  @IsEnum(TeamMode)
  team_mode?: TeamMode;

  @IsOptional()
  @IsEnum(TournamentFormat)
  format?: TournamentFormat;

  @IsOptional()
  @IsString()
  map?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}
