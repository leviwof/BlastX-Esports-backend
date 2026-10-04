import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { SquadsService } from './squads.service';
import { SwapSquadMembersDto } from './dto/swap-squad-members.dto';
import { TransferSquadLeaderDto } from './dto/transfer-squad-leader.dto';
import { UpdateSquadMemberRoleDto } from './dto/update-squad-member-role.dto';

@Controller('squads')
export class SquadsController {
  constructor(private readonly squads: SquadsService) {}

  @Post()
  saveMyRegisteredSquad(@CurrentUser() user: JwtUser) {
    return this.squads.saveMyRegisteredSquad(user.sub);
  }

  @Get('me')
  getMySquad(@CurrentUser() user: JwtUser) {
    return this.squads.getMySquad(user.sub);
  }

  @Delete(':squadId/members/:userId')
  removeMember(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Param('userId') userId: string,
  ) {
    return this.squads.removeMember(user.sub, squadId, userId);
  }

  @Post(':squadId/members/:userId')
  removeMemberPost(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Param('userId') userId: string,
  ) {
    return this.squads.removeMember(user.sub, squadId, userId);
  }

  @Post(':squadId/transfer-leader')
  transferLeader(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Body() dto: TransferSquadLeaderDto,
  ) {
    return this.squads.transferLeader(user.sub, squadId, dto);
  }

  @Patch(':squadId/members/:userId/role')
  updateMemberRole(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateSquadMemberRoleDto,
  ) {
    return this.squads.updateMemberRole(user.sub, squadId, userId, dto);
  }

  @Post(':squadId/swap')
  swapMembers(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Body() dto: SwapSquadMembersDto,
  ) {
    return this.squads.swapMembers(user.sub, squadId, dto);
  }

  @Post(':squadId/tournaments/:tournamentId/invite')
  inviteToTournament(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Param('tournamentId') tournamentId: string,
  ) {
    return this.squads.inviteSquadToTournament(user.sub, squadId, tournamentId);
  }
}
