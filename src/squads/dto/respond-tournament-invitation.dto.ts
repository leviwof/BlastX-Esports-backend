import { IsIn } from 'class-validator';

export class RespondTournamentInvitationDto {
  @IsIn(['ACCEPT', 'REJECT'])
  action!: 'ACCEPT' | 'REJECT';
}
