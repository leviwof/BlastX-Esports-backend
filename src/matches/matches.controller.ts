import { Controller, Get, Param } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { toMatchResponse, MatchResponse } from './match.mapper';

@Controller('tournaments')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get(':id/matches')
  async getMatches(@Param('id') tournamentId: string): Promise<MatchResponse[]> {
    const matches = await this.matchesService.getMatchesForTournament(tournamentId);
    return matches.map(toMatchResponse);
  }
}
