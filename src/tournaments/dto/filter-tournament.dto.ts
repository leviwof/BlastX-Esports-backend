import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { TeamMode, TournamentFormat, TournamentSection } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination.dto';
import { Transform } from 'class-transformer';

/**
 * Virtual status values the app can send.
 *
 * When the Flutter Live screen sends status=UPCOMING we must return
 * UPCOMING + REGISTRATION_OPEN + REGISTRATION_CLOSED.  We handle this
 * by accepting the raw string and expanding it in TournamentsService.
 */
export class FilterTournamentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TournamentSection)
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  section?: TournamentSection;

  @IsOptional()
  @IsString()
  game?: string;

  @IsOptional()
  @IsString()
  game_slug?: string;

  /**
   * The app sends one of: LIVE | UPCOMING | COMPLETED.
   * UPCOMING is automatically expanded to include REGISTRATION_OPEN and
   * REGISTRATION_CLOSED (see TournamentsService.getTournaments).
   * DRAFT and CANCELLED are always excluded from public listings.
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  status?: string;

  @IsOptional()
  @IsString()
  team_mode?: TeamMode;

  @IsOptional()
  @IsString()
  format?: TournamentFormat;

  @IsOptional()
  @IsString()
  map?: string;

  /** Full-text search: matched against title and organizer_name (case-insensitive). */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}
