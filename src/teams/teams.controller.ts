import { Controller, Get, Post, Patch, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { SubstitutesToggleDto } from './dto/substitutes-toggle.dto';
import { TransferCaptainDto } from './dto/transfer-captain.dto';
import { UpdatePlayingRosterDto } from './dto/update-playing-roster.dto';
import { toTeamResponse, TeamResponse } from './team.mapper';

@Controller(['teams', 'api/teams', 'tournaments/teams', 'api/tournaments/teams', 'v1/tournaments/teams'])
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  async createTeam(@CurrentUser() user: JwtUser, @Body() dto: CreateTeamDto): Promise<TeamResponse> {
    const team = await this.teamsService.createTeam(user.sub, dto);
    return toTeamResponse(team, user.sub);
  }

  @Get('me')
  async getMyTeams(@CurrentUser() user: JwtUser): Promise<TeamResponse[]> {
    const teams = await this.teamsService.getTeamsForUser(user.sub);
    return teams.map((t) => toTeamResponse(t, user.sub));
  }

  @Post('join-requests/:requestId/cancel')
  async cancelJoinRequest(
    @CurrentUser() user: JwtUser,
    @Param('requestId') requestId: string,
  ) {
    return this.teamsService.cancelJoinRequest(user.sub, requestId);
  }

  @Post('join')
  async joinTeam(@CurrentUser() user: JwtUser, @Body() dto: JoinTeamDto): Promise<any> {
    return this.teamsService.joinTeam(user.sub, dto);
  }

  @Get(':id/join-requests')
  async getJoinRequests(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
  ) {
    return this.teamsService.getPendingJoinRequests(user.sub, teamId);
  }

  @Post(':id/join-requests/:requestId/approve')
  async approveJoinRequest(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.teamsService.approveJoinRequest(user.sub, teamId, requestId);
  }

  @Post(':id/join-requests/:requestId/reject')
  async rejectJoinRequest(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.teamsService.rejectJoinRequest(user.sub, teamId, requestId);
  }

  @Get(':id')
  async getTeamById(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<TeamResponse> {
    const team = await this.teamsService.getTeamById(id, user.sub);
    return toTeamResponse(team, user.sub);
  }

  @Post(':id/join')
  async joinTeamById(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: JoinTeamDto,
  ): Promise<any> {
    return this.teamsService.joinTeam(user.sub, dto, id);
  }

  @Post(':id/leave')
  async leaveTeam(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<{ message: string }> {
    return this.teamsService.leaveTeam(user.sub, id);
  }

  @Post(':id/members/:userId')
  async removeMemberPost(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Param('userId') targetUserId: string,
  ): Promise<{ message: string }> {
    return this.teamsService.removeMember(user.sub, teamId, targetUserId);
  }

  @Delete(':id/members/:userId')
  async removeMemberDelete(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Param('userId') targetUserId: string,
  ): Promise<{ message: string }> {
    return this.teamsService.removeMemberOrLeave(user.sub, teamId, targetUserId);
  }

  @Post(':id/transfer-captain')
  async transferCaptain(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Body() dto: TransferCaptainDto,
  ): Promise<TeamResponse> {
    const targetUserId = dto.new_captain_id || dto.user_id;
    if (!targetUserId) {
      throw new Error('Target new_captain_id is required');
    }
    const team = await this.teamsService.transferCaptaincy(user.sub, teamId, targetUserId);
    return toTeamResponse(team, user.sub);
  }

  @Patch(':id/substitutes')
  async toggleSubstitutes(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Body() dto: SubstitutesToggleDto,
  ): Promise<TeamResponse> {
    const value = dto.accepting_substitutes ?? dto.acceptingSubstitutes ?? true;
    const team = await this.teamsService.toggleSubstitutes(user.sub, teamId, value);
    return toTeamResponse(team, user.sub);
  }

  @Post(':id/regenerate-invite')
  async regenerateInvite(@CurrentUser() user: JwtUser, @Param('id') teamId: string): Promise<TeamResponse> {
    const team = await this.teamsService.regenerateInviteCode(user.sub, teamId);
    return toTeamResponse(team, user.sub);
  }

  @Put(':id/playing-roster')
  async updatePlayingRoster(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Body() dto: UpdatePlayingRosterDto,
  ): Promise<TeamResponse> {
    const team = await this.teamsService.updatePlayingRoster(user.sub, teamId, dto.main_user_ids);
    return toTeamResponse(team, user.sub);
  }

  @Patch(':id')
  async updateTeam(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamResponse> {
    const team = await this.teamsService.updateTeam(user.sub, teamId, dto);
    return toTeamResponse(team, user.sub);
  }
}
