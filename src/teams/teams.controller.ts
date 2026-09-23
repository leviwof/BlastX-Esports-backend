import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { SubstitutesToggleDto } from './dto/substitutes-toggle.dto';
import { TransferCaptainDto } from './dto/transfer-captain.dto';
import { toTeamResponse, TeamResponse } from './team.mapper';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  async createTeam(@CurrentUser() user: JwtUser, @Body() dto: CreateTeamDto): Promise<TeamResponse> {
    const team = await this.teamsService.createTeam(user.sub, dto);
    return toTeamResponse(team);
  }

  @Get('me')
  async getMyTeams(@CurrentUser() user: JwtUser): Promise<TeamResponse[]> {
    const teams = await this.teamsService.getTeamsForUser(user.sub);
    return teams.map(toTeamResponse);
  }

  @Get(':id')
  async getTeamById(@Param('id') id: string): Promise<TeamResponse> {
    const team = await this.teamsService.getTeamById(id);
    return toTeamResponse(team);
  }

  @Post('join')
  async joinTeam(@CurrentUser() user: JwtUser, @Body() dto: JoinTeamDto): Promise<TeamResponse> {
    const team = await this.teamsService.joinTeam(user.sub, dto);
    return toTeamResponse(team);
  }

  @Post(':id/join')
  async joinTeamById(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: JoinTeamDto,
  ): Promise<TeamResponse> {
    const team = await this.teamsService.joinTeam(user.sub, dto, id);
    return toTeamResponse(team);
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
    return toTeamResponse(team);
  }

  @Patch(':id/substitutes')
  async toggleSubstitutes(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Body() dto: SubstitutesToggleDto,
  ): Promise<TeamResponse> {
    const team = await this.teamsService.toggleSubstitutes(user.sub, teamId, dto.accepting_substitutes);
    return toTeamResponse(team);
  }

  @Post(':id/regenerate-invite')
  async regenerateInvite(@CurrentUser() user: JwtUser, @Param('id') teamId: string): Promise<TeamResponse> {
    const team = await this.teamsService.regenerateInviteCode(user.sub, teamId);
    return toTeamResponse(team);
  }

  @Patch(':id')
  async updateTeam(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamResponse> {
    const team = await this.teamsService.updateTeam(user.sub, teamId, dto);
    return toTeamResponse(team);
  }
}
