import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { SquadsService } from './squads.service';
import { CreateSquadDto } from './dto/create-squad.dto';
import { JoinSquadDto } from './dto/join-squad.dto';
import { SwapSquadMembersDto } from './dto/swap-squad-members.dto';
import { TransferSquadLeaderDto } from './dto/transfer-squad-leader.dto';
import { UpdateSquadMemberRoleDto } from './dto/update-squad-member-role.dto';

@Controller('squads')
export class SquadsController {
  constructor(private readonly squads: SquadsService) {}

  @Post()
  createOrSaveSquad(@CurrentUser() user: JwtUser, @Body() dto?: CreateSquadDto) {
    if (dto && dto.name) {
      return this.squads.createSquad(user.sub, dto);
    }
    return this.squads.saveMyRegisteredSquad(user.sub);
  }

  @Post('join')
  joinSquad(@CurrentUser() user: JwtUser, @Body() dto: JoinSquadDto) {
    return this.squads.joinSquad(user.sub, dto);
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

  @Post(':squadId/remove-member')
  removeMemberBody(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Body('user_id') userId: string,
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

  @Post(':squadId/transfer-leadership')
  transferLeadership(
    @CurrentUser() user: JwtUser,
    @Param('squadId') squadId: string,
    @Body('new_leader_id') newLeaderId: string,
  ) {
    return this.squads.transferLeader(user.sub, squadId, { new_leader_id: newLeaderId });
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

  @Post(':squadId/swap-members')
  swapMembersBody(
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
