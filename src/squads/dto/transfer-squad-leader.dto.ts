import { IsString, MinLength } from 'class-validator';

export class TransferSquadLeaderDto {
  @IsString()
  @MinLength(1)
  new_leader_id!: string;
}
