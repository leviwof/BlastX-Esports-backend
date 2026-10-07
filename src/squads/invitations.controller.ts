import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { RespondTournamentInvitationDto } from './dto/respond-tournament-invitation.dto';
import { SquadsService } from './squads.service';

@Controller(['invitations', 'squad/invitations', 'api/squad/invitations', 'api/invitations'])
export class InvitationsController {
  constructor(private readonly squads: SquadsService) {}

  @Get(['pending', ''])
  async getPending(@CurrentUser() user: JwtUser) {
    const list = await this.squads.getPendingInvitations(user.sub);
    return {
      success: true,
      invitations: list,
    };
  }

  @Post(':invitationId/respond')
  respond(
    @CurrentUser() user: JwtUser,
    @Param('invitationId') invitationId: string,
    @Body() dto: RespondTournamentInvitationDto,
  ) {
    return this.squads.respondToInvitation(user.sub, invitationId, dto.action);
  }

  @Post(':tournamentId/send')
  sendInvitation(
    @CurrentUser() user: JwtUser,
    @Param('tournamentId') tournamentId: string,
    @Body('squad_id') squadId?: string,
  ) {
    return this.squads.inviteSquadToTournament(user.sub, squadId || '', tournamentId);
  }
}
