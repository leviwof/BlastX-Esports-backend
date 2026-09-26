import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { MatchesService } from '../matches/matches.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { FilterTournamentQueryDto } from './dto/filter-tournament.dto';
import { RegisterTournamentDto } from './dto/register-tournament.dto';
import { CreateTournamentTeamDto } from './dto/create-tournament-team.dto';
import {
  toTournamentResponse,
  toTournamentRegistrationResponse,
  TournamentResponse,
  TournamentRegistrationResponse,
  TournamentBracketResponse,
} from './tournament.mapper';
import { PaginatedResult } from '../common/pagination.dto';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { LeaderboardEntry } from '../matches/match.mapper';

@Controller('tournaments')
export class TournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly matchesService: MatchesService,
    private readonly jwtService: JwtService,
  ) {}

  @Get()
  async getTournaments(@Query() query: FilterTournamentQueryDto): Promise<PaginatedResult<TournamentResponse>> {
    const result = await this.tournamentsService.getTournaments(query);
    return {
      ...result,
      items: result.items.map((item) => toTournamentResponse(item)),
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyTournaments(@CurrentUser() user: JwtUser): Promise<TournamentResponse[]> {
    const items = await this.tournamentsService.getMyTournaments(user.sub);
    return items.map((item) => toTournamentResponse(item, user.sub));
  }

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
    return toTournamentResponse(tournament, currentUserId);
  }

  @Post(':id/register')
  @UseGuards(JwtAuthGuard)
  async register(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: RegisterTournamentDto,
  ): Promise<TournamentRegistrationResponse> {
    const registration = await this.tournamentsService.registerUserOrTeam(user.sub, id, dto);
    return toTournamentRegistrationResponse(registration);
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
  ): Promise<{ room_id: string; room_password: string; room_released_at: Date | null }> {
    return this.tournamentsService.getRoomCredentials(user.sub, id);
  }

  @Get(':id/participants')
  async getParticipants(@Param('id') id: string): Promise<TournamentRegistrationResponse[]> {
    const items = await this.tournamentsService.getParticipants(id);
    return items.map(toTournamentRegistrationResponse);
  }

  @Get(':id/leaderboard')
  async getLeaderboard(@Param('id') id: string): Promise<LeaderboardEntry[]> {
    return this.matchesService.getLeaderboard(id);
  }

  @Get(':id/bracket')
  async getBracket(@Param('id') id: string): Promise<TournamentBracketResponse> {
    return this.tournamentsService.getTournamentBracket(id);
  }

  @Get(':id/roadmap')
  async getRoadmap(@Param('id') id: string): Promise<TournamentBracketResponse> {
    return this.tournamentsService.getTournamentBracket(id);
  }

  @Get(':id/my-team')
  @UseGuards(JwtAuthGuard)
  async getMyTeam(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.tournamentsService.getMyTeamForTournament(user.sub, id);
  }

  @Post(':id/teams')
  @UseGuards(JwtAuthGuard)
  async createTournamentTeam(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: CreateTournamentTeamDto,
  ) {
    return this.tournamentsService.createTournamentTeam(user.sub, id, dto);
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
}

