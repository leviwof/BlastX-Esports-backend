import { IsOptional, IsString } from 'class-validator';

export class RegisterTournamentDto {
  @IsOptional()
  @IsString()
  team_id?: string;
}
