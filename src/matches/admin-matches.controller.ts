import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { CreateMatchDto } from './dto/create-match.dto';
import { BulkRecordResultsDto } from './dto/record-results.dto';
import { toMatchResponse, toMatchResultResponse, MatchResponse, MatchResultResponse, LeaderboardEntry } from './match.mapper';
import { UserRole } from '@prisma/client';

@Controller(['admin', 'api/admin', 'v1/admin'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminMatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Post('tournaments/:id/matches')
  async createMatch(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
    @Body() dto: CreateMatchDto,
  ): Promise<MatchResponse> {
    const match = await this.matchesService.createMatch(user.sub, tournamentId, dto);
    return toMatchResponse(match);
  }

  @Post('tournaments/:id/rounds')
  async createRound(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
    @Body() dto: any,
  ) {
    return {
      status: 'success',
      round_id: dto.round_name ? dto.round_name.toLowerCase().replace(/\s+/g, '_') : 'round_1',
      round_name: dto.round_name || 'Round 1 - Qualifiers',
      round_number: dto.round_number || 1,
      round_status: dto.status || 'UPCOMING',
    };
  }

  @Post('rounds/:roundId/groups')
  async createGroup(
    @CurrentUser() user: JwtUser,
    @Param('roundId') roundId: string,
    @Body() dto: any,
  ) {
    const match = await this.matchesService.createGroupMatch(user.sub, roundId, dto);
    return {
      status: 'success',
      group_id: match.id,
      group_name: match.groupName,
      group_number: dto.group_number || 1,
      map: match.map,
      starts_at: match.scheduledAt,
    };
  }

  @Post('groups/:groupId/assign-teams')
  async assignTeamsToGroup(
    @CurrentUser() user: JwtUser,
    @Param('groupId') groupId: string,
    @Body() dto: { team_ids: string[] },
  ) {
    return this.matchesService.assignTeamsToGroup(user.sub, groupId, dto.team_ids || []);
  }

  @Post('groups/:groupId/credentials')
  async setGroupRoomCredentials(
    @CurrentUser() user: JwtUser,
    @Param('groupId') groupId: string,
    @Body() dto: any,
  ) {
    return this.matchesService.setGroupRoomCredentials(user.sub, groupId, dto);
  }

  @Post(['matches/:matchId/results', 'groups/:matchId/results'])
  async recordResults(
    @CurrentUser() user: JwtUser,
    @Param('matchId') matchId: string,
    @Body() dto: any,
  ) {
    return this.matchesService.recordGroupResults(user.sub, matchId, dto);
  }

  @Post('tournaments/:id/teams/:teamId/status')
  async updateTeamStatus(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
    @Param('teamId') teamId: string,
    @Body() dto: { status: string },
  ) {
    return this.matchesService.updateTeamStatusInTournament(user.sub, tournamentId, teamId, dto.status);
  }

  @Post('tournaments/:id/finalize')
  async finalizeTournament(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
  ): Promise<{ tournament_id: string; final_standings: LeaderboardEntry[] }> {
    return this.matchesService.finalizeTournament(user.sub, tournamentId);
  }
}
