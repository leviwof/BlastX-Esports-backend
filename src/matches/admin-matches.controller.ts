import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { CreateMatchDto } from './dto/create-match.dto';
import { BulkRecordResultsDto } from './dto/record-results.dto';
import { toMatchResponse, toMatchResultResponse, MatchResponse, MatchResultResponse, LeaderboardEntry } from './match.mapper';
import { UserRole } from '@prisma/client';

@Controller('admin')
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

  @Post('matches/:matchId/results')
  async recordResults(
    @CurrentUser() user: JwtUser,
    @Param('matchId') matchId: string,
    @Body() dto: BulkRecordResultsDto,
  ): Promise<MatchResultResponse[]> {
    const results = await this.matchesService.recordMatchResults(user.sub, matchId, dto);
    return results.map(toMatchResultResponse);
  }

  @Post('tournaments/:id/finalize')
  async finalizeTournament(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
  ): Promise<{ tournament_id: string; final_standings: LeaderboardEntry[] }> {
    return this.matchesService.finalizeTournament(user.sub, tournamentId);
  }
}
