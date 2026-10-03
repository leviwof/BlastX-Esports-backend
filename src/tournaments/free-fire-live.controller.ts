import { Controller, Get, NotFoundException, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { TournamentSection } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Public } from '../common/public.decorator';
import { MatchesService } from '../matches/matches.service';
import { toMatchResponse } from '../matches/match.mapper';
import { FilterTournamentQueryDto } from './dto/filter-tournament.dto';
import { TournamentsService } from './tournaments.service';

/** Public API contract for the dedicated Free Fire Live experience. */
@Controller('free-fire-live')
export class FreeFireLiveController {
  constructor(
    private readonly tournaments: TournamentsService,
    private readonly matches: MatchesService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Get()
  async list(@Query() query: FilterTournamentQueryDto) {
    // Cursor is a page token for this offset-backed implementation.  Page
    // remains supported for clients that use the standard pagination model.
    if (query.cursor && /^\d+$/.test(query.cursor)) query.page = Math.max(1, Number(query.cursor));
    const result = await this.tournaments.getTournaments(query, TournamentSection.FREEFIRE_LIVE);
    return {
      status: 'success', page: result.page, limit: result.limit, total: result.total,
      next_cursor: result.page * result.limit < result.total ? String(result.page + 1) : null,
      items: result.items.map((t) => this.summary(t)),
    };
  }

  @Public()
  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const userId = await this.optionalUser(req);
    const tournament = await this.tournaments.getTournamentById(id, userId);
    this.assertLive(tournament.section);
    return this.summary(tournament, true);
  }

  @Get(':id/room')
  @UseGuards(JwtAuthGuard)
  async room(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const tournament = await this.tournaments.getTournamentById(id);
    this.assertLive(tournament.section);
    const data = await this.tournaments.getRoomCredentials(user.sub, id);
    return { status: 'success', data };
  }

  @Public()
  @Get(':id/matches')
  async timeline(@Param('id') id: string) {
    const tournament = await this.tournaments.getTournamentById(id);
    this.assertLive(tournament.section);
    const matches = await this.matches.getMatchesForTournament(id);
    return { status: 'success', matches: matches.map(toMatchResponse) };
  }

  @Public()
  @Get(':id/leaderboard')
  async leaderboard(@Param('id') id: string, @Query('round') round: string | undefined, @Res() res: Response) {
    const tournament = await this.tournaments.getTournamentById(id);
    this.assertLive(tournament.section);
    const leaderboard = await this.matches.getLeaderboard(id, round);
    res!.json({
      tournamentId: id,
      round: leaderboard.round,
      updatedAt: leaderboard.updated_at,
      data: leaderboard.entries.map((entry) => ({
        rank: entry.rank, prevRank: entry.prev_rank, teamId: entry.team_id,
        teamName: entry.team_name ?? entry.participant_name, logoUrl: entry.logo_url,
        kills: entry.kills ?? 0, placementPoints: entry.placement_points,
        totalPoints: entry.total_points, status: entry.status?.toUpperCase() ?? 'ACTIVE',
      })),
    });
  }

  private assertLive(section: TournamentSection): void {
    if (section !== TournamentSection.FREEFIRE_LIVE) throw new NotFoundException('Free Fire Live tournament not found');
  }

  private async optionalUser(req: Request): Promise<string | undefined> {
    const header = req.headers.authorization;
    if (!header) return undefined;
    try { return (await this.jwt.verifyAsync<JwtUser>(header.replace(/^Bearer\s+/i, ''))).sub; } catch { return undefined; }
  }

  private summary(t: any, detail = false) {
    const registered = t.registrations?.some((r: any) => r.status === 'CONFIRMED') ?? false;
    const base = {
      id: t.id, title: t.title, game: t.game?.name ?? 'Free Fire', banner_url: t.bannerUrl,
      prize_pool: t.prizePool, currency: '\u20B9', viewersCount: t.viewersCount,
      status: t.status, starts_at: t.startsAt, organizer: t.organizerName ?? 'BlastX Esports',
      organizerVerified: t.organizerVerified, accentColorHex: t.accentColorHex,
      team_mode: t.teamMode, map: t.map, format: t.format, entry_fee: t.entryFee,
      max_slots: t.maxSlots, filledSlots: t.registeredCount, registered_count: t.registeredCount,
      slots_left: Math.max(0, t.maxSlots - t.registeredCount), is_registered: registered,
      streamUrl: t.streamUrl, description: t.description,
    };
    return detail ? {
      ...base, booyahBonus: t.booyahBonus, perKillReward: t.perKillReward,
      prize_distribution: t.prizeDistribution, pointsSystem: t.pointsSystem,
      schedule: t.schedule, rules: t.rules, announcements: t.announcements,
    } : base;
  }
}
