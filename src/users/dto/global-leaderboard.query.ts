import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GlobalLeaderboardQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['points', 'kills', 'xp', 'tournamentsWon'])
  sortBy?: 'points' | 'kills' | 'xp' | 'tournamentsWon' = 'points';
}
