import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { MatchesService } from '../matches/matches.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Public } from '../common/public.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { FilterTournamentQueryDto } from './dto/filter-tournament.dto';
import { RegisterTournamentDto } from './dto/register-tournament.dto';
import { CreateTournamentTeamDto } from './dto/create-tournament-team.dto';
import {
  RegistrationStatus,
} from '@prisma/client';
import {
  toTournamentResponse,
  toTournamentRegistrationResponse,
  TournamentResponse,
  TournamentRegistrationResponse,
  TournamentBracketResponse,
} from './tournament.mapper';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { LeaderboardEntry } from '../matches/match.mapper';

import { TeamsService } from '../teams/teams.service';
import { JoinTeamDto } from '../teams/dto/join-team.dto';
import { toTeamResponse, TeamResponse } from '../teams/team.mapper';

@Controller(['tournaments', 'api/tournaments'])
export class TournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly matchesService: MatchesService,
    private readonly jwtService: JwtService,
    private readonly teamsService: TeamsService,
  ) {}

  @Public()
  @Get()
  async getTournaments(@Query() query: FilterTournamentQueryDto, @Req() req: Request) {
    let currentUserId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const payload = await this.jwtService.verifyAsync<JwtUser>(token);
        currentUserId = payload.sub;
      } catch {
        // Token invalid, ignore for public view
      }
    }

    const result = await this.tournamentsService.getTournaments(query);
    return {
      status: 'success',
      // API clients unwrap this envelope, so pagination must live in `data`.
      data: {
        items: result.items.map((item) => toTournamentResponse(item, currentUserId)),
        counts: result.counts,
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyTournaments(@CurrentUser() user: JwtUser): Promise<TournamentResponse[]> {
    const items = await this.tournamentsService.getMyTournaments(user.sub);
    return items.map((item) => toTournamentResponse(item, user.sub));
  }

  @Public()
  @Get(':id')
  async getTournamentById(@Param('id') id: string, @Req() req: Request): Promise<TournamentResponse> {
    let currentUserId: string | undefined;

    // Optional token extraction if Authorization header is present
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const payload = await this.jwtService.verifyAsync<JwtUser>(token);
        currentUserId = payload.sub;
      } catch {
        // Token invalid, ignore for public view
      }
    }

    const tournament = await this.tournamentsService.getTournamentById(id, currentUserId);
    // includeRoom = false: room credentials are NEVER returned on this public endpoint
    return toTournamentResponse(tournament, currentUserId, false);
  }

  @Post(':id/register')
  @UseGuards(JwtAuthGuard)
  async register(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: RegisterTournamentDto,
  ): Promise<TournamentRegistrationResponse> {
    const registration = await this.tournamentsService.registerUserOrTeam(user.sub, id, dto);
    const response = toTournamentRegistrationResponse(registration);
    const isWaitlist = registration.status === RegistrationStatus.WAITLIST;
    return {
      ...response,
      status: 'success',
      success: true,
      registration_status: registration.status,
      message: isWaitlist
        ? 'Team registered on Waitlist. 4 main players required to enter match lobbies.'
        : registration.teamId
        ? 'Team successfully registered for tournament'
        : 'Successfully registered for tournament',
      data: {
        registration_id: response.id,
        tournament_id: response.tournament_id,
        team_id: response.team_id,
        registered_at: response.created_at,
      },
    };
  }

  @Delete(':id/register')
  @UseGuards(JwtAuthGuard)
  async unregister(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<{ message: string }> {
    return this.tournamentsService.unregisterUserOrTeam(user.sub, id);
  }

  @Post(':id/register/delete')
  @UseGuards(JwtAuthGuard)
  async unregisterPost(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<{ message: string }> {
    return this.tournamentsService.unregisterUserOrTeam(user.sub, id);
  }

  @Get(':id/room')
  @UseGuards(JwtAuthGuard)
  async getRoomDetails(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    const room = await this.tournamentsService.getRoomCredentials(user.sub, id);
    return {
      status: 'success',
      data: {
        room_id: room.room_id,
        password: room.room_password,
        room_password: room.room_password,
        starts_at: room.starts_at,
        visible_from: room.visibleFrom,
        status: 'READY',
      },
    };
  }

  @Public()
  @Get(':id/participants')
  async getParticipants(@Param('id') id: string): Promise<TournamentRegistrationResponse[]> {
    const items = await this.tournamentsService.getParticipants(id);
    return items.map(toTournamentRegistrationResponse);
  }

  /**
   * Teams tab — read-only list of registered teams in a tournament.
   * Returns the same data as /participants but shaped as team objects
   * (one row per team, not per registration).
   */
  @Public()
  @Get(':id/teams')
  async getTeams(@Param('id') id: string) {
    return this.tournamentsService.getTeamsForTournament(id);
  }

  @Public()
  @Get(':id/registered-teams')
  async getRegisteredTeams(@Param('id') id: string) {
    const data = await this.tournamentsService.getRegisteredTeamsForTournament(id);
    return { status: 'success', total: data.length, data };
  }

  /**
   * Leaderboard — polled every 20 s by the Flutter app while the tournament
   * is LIVE. Cache-Control is set to max-age=10 s to allow CDN/proxy caching.
   * Optional query: ?round=<round name>
   */
  @Public()
  @Get(':id/leaderboard')
  async getLeaderboard(
    @Param('id') id: string,
    @Query('round') round: string | undefined,
    @Res() res: Response,
  ) {
    const leaderboard = await this.matchesService.getLeaderboard(id, round);
    res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=5');
    res.json({ status: 'success', data: leaderboard });
  }

  @Public()
  @Get(':id/bracket')
  async getBracket(@Param('id') id: string): Promise<TournamentBracketResponse> {
    return this.tournamentsService.getTournamentBracket(id);
  }

  @Public()
  @Get(':id/roadmap')
  async getRoadmap(@Param('id') id: string): Promise<TournamentBracketResponse> {
    return this.tournamentsService.getTournamentBracket(id);
  }

  @Get([':id/my-team', ':id/teams/me'])
  @UseGuards(JwtAuthGuard)
  async getMyTeam(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const team = await this.tournamentsService.getMyTeamForTournament(user.sub, id);
    if (!team) {
      throw new NotFoundException(`No registered team found for tournament '${id}'`);
    }
    const regStatus = team.registration_status || (team.is_registered ? 'REGISTERED' : 'FORMING');
    return {
      team: {
        ...team,
        registration_status: regStatus,
      },
      ...team,
      registration_status: regStatus,
    };
  }

  @Post(':id/teams')
  @UseGuards(JwtAuthGuard)
  async createTournamentTeam(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: CreateTournamentTeamDto,
  ) {
    const team = await this.tournamentsService.createTournamentTeam(user.sub, id, dto);
    return { status: 'success' as const, data: team, ...team };
  }

  @Get(':id/teams/code/:code')
  @UseGuards(JwtAuthGuard)
  async getTeamByCode(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('code') code: string,
  ) {
    return this.tournamentsService.previewTeamByCode(id, code, user.sub);
  }

  @Post(':id/teams/:teamId/join')
  @UseGuards(JwtAuthGuard)
  async joinTournamentTeamById(
    @CurrentUser() user: JwtUser,
    @Param('teamId') teamId: string,
    @Body() dto: JoinTeamDto,
  ): Promise<TeamResponse> {
    const team = await this.teamsService.joinTeam(user.sub, dto, teamId);
    return toTeamResponse(team);
  }

  @Post(':id/teams/join')
  @UseGuards(JwtAuthGuard)
  async joinTournamentTeam(
    @CurrentUser() user: JwtUser,
    @Body() dto: JoinTeamDto,
  ): Promise<TeamResponse> {
    const team = await this.teamsService.joinTeam(user.sub, dto);
    return toTeamResponse(team);
  }
}
