import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { RespondTournamentInvitationDto } from './dto/respond-tournament-invitation.dto';
import { SquadsService } from './squads.service';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly squads: SquadsService) {}

  @Get('pending')
  getPending(@CurrentUser() user: JwtUser) {
    return this.squads.getPendingInvitations(user.sub);
  }

  @Post(':invitationId/respond')
  respond(
    @CurrentUser() user: JwtUser,
    @Param('invitationId') invitationId: string,
    @Body() dto: RespondTournamentInvitationDto,
  ) {
    return this.squads.respondToInvitation(user.sub, invitationId, dto.action);
  }
}
