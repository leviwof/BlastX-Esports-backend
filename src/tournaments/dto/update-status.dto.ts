import { IsNotEmpty, IsEnum } from 'class-validator';
import { TournamentStatus } from '@prisma/client';

export class UpdateTournamentStatusDto {
  @IsNotEmpty()
  @IsEnum(TournamentStatus)
  status!: TournamentStatus;
}
