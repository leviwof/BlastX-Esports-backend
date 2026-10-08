import { Controller, Get, Param, Res } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { toMatchResponse } from './match.mapper';
import { Public } from '../common/public.decorator';
import { Response } from 'express';

@Controller('tournaments')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Public()
  @Get(':id/matches')
  async getMatches(@Param('id') tournamentId: string, @Res() res: Response) {
    const result = await this.matchesService.getGroupedMatchesForTournament(tournamentId);
    res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=5');
    res.json({
      status: 'success',
      data: result.matches,
      groups: result.groups,
    });
  }
}
