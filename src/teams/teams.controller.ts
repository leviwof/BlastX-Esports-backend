import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
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

  @Delete(':id/members/:userId')
  async removeMember(
    @CurrentUser() user: JwtUser,
    @Param('id') teamId: string,
    @Param('userId') targetUserId: string,
  ): Promise<{ message: string }> {
    return this.teamsService.removeMemberOrLeave(user.sub, teamId, targetUserId);
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
