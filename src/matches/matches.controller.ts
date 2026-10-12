import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchAccessService } from './match-access.service';
import { Public } from '../common/public.decorator';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Controller(['tournaments', 'api/tournaments', 'v1/tournaments'])
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    private readonly matchAccessService: MatchAccessService,
    private readonly jwtService: JwtService,
  ) {}

  @Public()
  @Get(':id/matches')
  async getMatches(
    @Param('id') tournamentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
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

    const result = await this.matchesService.getGroupedMatchesForTournament(
      tournamentId,
      currentUserId,
    );
    res.setHeader(
      'Cache-Control',
      'public, max-age=10, stale-while-revalidate=5',
    );
    res.json(result);
  }

  /**
   * Match Center - GET /v1/tournaments/:id/match-center
   * Access restricted to CONFIRMED participants.
   */
  @Get(':id/match-center')
  @UseGuards(JwtAuthGuard)
  async getMatchCenter(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
  ) {
    return this.matchAccessService.getMatchCenter(tournamentId, user.sub);
  }

  /**
   * Room Credentials for specific Match Unit - GET /v1/tournaments/:id/matches/:matchKey/room
   * Returns { room_id, room_password, visible_from, scheduled_at }
   */
  @Get(':id/matches/:matchKey/room')
  @UseGuards(JwtAuthGuard)
  async getMatchRoomCredentials(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
    @Param('matchKey') matchKey: string,
  ) {
    return this.matchAccessService.assertCanSeeCredentials(
      user.sub,
      matchKey,
      tournamentId,
    );
  }

  /**
   * Match Detail - GET /v1/tournaments/:id/matches/:matchKey
   */
  @Get(':id/matches/:matchKey')
  @UseGuards(JwtAuthGuard)
  async getMatchDetail(
    @CurrentUser() user: JwtUser,
    @Param('id') tournamentId: string,
    @Param('matchKey') matchKey: string,
  ) {
    return this.matchAccessService.getMatchDetail(
      tournamentId,
      matchKey,
      user.sub,
    );
  }
}
