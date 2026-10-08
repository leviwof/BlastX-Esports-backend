import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { Public } from '../common/public.decorator';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { JwtUser } from '../common/current-user.decorator';

@Controller(['tournaments', 'api/tournaments', 'v1/tournaments'])
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    private readonly jwtService: JwtService,
  ) {}

  @Public()
  @Get(':id/matches')
  async getMatches(@Param('id') tournamentId: string, @Req() req: Request, @Res() res: Response) {
    let currentUserId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const payload = await this.jwtService.verifyAsync<JwtUser>(token);
        currentUserId = payload.sub;
      } catch {
        // Token invalid/missing, ignore for public view
      }
    }

    const result = await this.matchesService.getGroupedMatchesForTournament(tournamentId, currentUserId);
    res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=5');
    res.json(result);
  }
}
