import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Match, MatchResult, TournamentFormat, TournamentStatus, MatchStatus, RegistrationStatus } from '@prisma/client';
import { CreateMatchDto } from './dto/create-match.dto';
import { BulkRecordResultsDto } from './dto/record-results.dto';
import { LeaderboardEntry, LeaderboardResponse, toMatchResponse, MatchResponse } from './match.mapper';
import { validateStatusTransition } from '../tournaments/tournament-state-machine';

const BR_PLACEMENT_POINTS: Record<number, number> = {
  1: 12,
  2: 9,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
};

import { calculatePoints } from './points-calculator';

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createMatch(adminId: string, tournamentId: string, dto: CreateMatchDto): Promise<Match> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const existingNumber = await this.prisma.match.findUnique({
      where: {
        unique_tournament_match_number: {
          tournamentId,
          matchNumber: dto.match_number,
        },
      },
    });
    if (existingNumber) {
      throw new BadRequestException(`Match #${dto.match_number} already exists for this tournament`);
    }

    return this.prisma.match.create({
      data: {
        tournamentId,
        matchNumber: dto.match_number,
        map: dto.map,
        scheduledAt: new Date(dto.scheduled_at),
        status: MatchStatus.SCHEDULED,
      },
    });
  }

  async recordMatchResults(adminId: string, matchId: string, dto: BulkRecordResultsDto): Promise<MatchResult[]> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { tournament: true },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    // Validate placement uniqueness and values in input
    const placements = dto.results.map((r) => r.placement);
    const uniquePlacements = new Set(placements);
    if (placements.length !== uniquePlacements.size) {
      throw new BadRequestException('Each registration in a match must have a unique placement number');
    }

    // Validate registration IDs belong to this tournament
    const registrationIds = dto.results.map((r) => r.registration_id);
    const validRegistrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        id: { in: registrationIds },
        tournamentId: match.tournamentId,
        status: RegistrationStatus.CONFIRMED,
      },
    });
    if (validRegistrations.length < registrationIds.length) {
      throw new BadRequestException('One or more registration IDs are invalid or not confirmed for this tournament');
    }

    // Upsert match results inside transaction
    const results = await this.prisma.$transaction(async (tx) => {
      const createdResults: MatchResult[] = [];

      for (const item of dto.results) {
        const { placementPoints, killPoints, totalPoints } = calculatePoints(
          match.tournament.format,
          item.placement,
          item.kills,
          match.tournament.perKillReward,
        );

        const res = await tx.matchResult.upsert({
          where: {
            unique_match_registration: {
              matchId,
              registrationId: item.registration_id,
            },
          },
          update: {
            placement: item.placement,
            kills: item.kills,
            placementPoints,
            killPoints,
            totalPoints,
          },
          create: {
            matchId,
            registrationId: item.registration_id,
            placement: item.placement,
            kills: item.kills,
            placementPoints,
            killPoints,
            totalPoints,
          },
        });
        createdResults.push(res);
      }

      await tx.match.update({
        where: { id: matchId },
        data: { status: MatchStatus.COMPLETED },
      });

      return createdResults;
    });

    // Rebuild leaderboard and update cache
    await this.rebuildLeaderboardCache(match.tournamentId);

    return results;
  }

  async getLeaderboard(tournamentId: string, round?: string): Promise<LeaderboardResponse> {
    const cacheKey = `lb:tournament:${tournamentId}:${round || 'all'}`;
    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Fallback to DB if Redis fails/offline
    }

    return this.rebuildLeaderboardCache(tournamentId, round);
  }

  async rebuildLeaderboardCache(tournamentId: string, roundQuery?: string): Promise<LeaderboardResponse> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          orderBy: { matchNumber: 'asc' },
        },
      },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
      },
      include: {
        user: true,
        team: true,
        matchResults: {
          include: { match: true },
          orderBy: { match: { matchNumber: 'desc' } },
        },
      },
    });

    const roundName =
      roundQuery ||
      (tournament.matches.length > 0
        ? (tournament.matches[tournament.matches.length - 1] as any).round || 'Grand Final'
        : 'Grand Final');

    if (registrations.length === 0) {
      const emptyResponse: LeaderboardResponse = {
        tournament_id: tournamentId,
        updated_at: new Date().toISOString(),
        round: roundName,
        entries: [],
      };
      return emptyResponse;
    }

    // Completed matches for prev_rank calculation
    const completedMatches = tournament.matches.filter((m) => m.status === MatchStatus.COMPLETED);
    const hasMultipleMatches = completedMatches.length >= 2;
    const latestCompletedMatchId = hasMultipleMatches ? completedMatches[completedMatches.length - 1].id : null;

    const calculateScore = (results: typeof registrations[0]['matchResults']) => {
      const totalPoints = results.reduce((acc, r) => acc + r.totalPoints, 0);
      const placementPoints = results.reduce((acc, r) => acc + r.placementPoints, 0);
      const killPoints = results.reduce((acc, r) => acc + r.killPoints, 0);
      const totalKills = results.reduce((acc, r) => acc + r.kills, 0);
      const booyahs = results.filter((r) => r.placement === 1).length;
      const lastPlacement = results.length > 0 ? results[0].placement : 999;
      return { totalPoints, placementPoints, killPoints, totalKills, booyahs, lastPlacement };
    };

    // Calculate previous ranks if at least 2 completed matches exist
    const prevRankMap = new Map<string, number>();
    if (latestCompletedMatchId) {
      const prevEntries = registrations.map((reg) => {
        const prevResults = reg.matchResults.filter((r) => r.matchId !== latestCompletedMatchId);
        const score = calculateScore(prevResults);
        return { id: reg.id, ...score };
      });

      prevEntries.sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.booyahs !== a.booyahs) return b.booyahs - a.booyahs;
        if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
        return a.lastPlacement - b.lastPlacement;
      });

      prevEntries.forEach((entry, idx) => {
        prevRankMap.set(entry.id, idx + 1);
      });
    }

    const currentEntries = registrations.map((reg) => {
      const results = roundQuery
        ? reg.matchResults.filter((r) => ((r.match as any).round || `Round ${r.match.matchNumber}`) === roundQuery)
        : reg.matchResults;

      const score = calculateScore(results);
      const participantName = reg.team ? reg.team.name : reg.user.name;
      const teamId = reg.teamId || reg.user.id;
      const logoUrl = reg.team?.logoUrl || reg.user.profilePic || null;

      return {
        registration_id: reg.id,
        team_id: teamId,
        participant_name: participantName,
        team_name: participantName,
        logo_url: logoUrl,
        team_tag: reg.team?.tag || null,
        total_points: score.totalPoints,
        placement_points: score.placementPoints,
        kill_points: score.killPoints,
        total_kills: score.totalKills,
        kills: score.totalKills,
        booyahs: score.booyahs,
        last_match_placement: score.lastPlacement,
      };
    });

    currentEntries.sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      if (b.booyahs !== a.booyahs) return b.booyahs - a.booyahs;
      if (b.total_kills !== a.total_kills) return b.total_kills - a.total_kills;
      return a.last_match_placement - b.last_match_placement;
    });

    const isCompleted = tournament.status === TournamentStatus.COMPLETED;
    const isLive = tournament.status === TournamentStatus.LIVE;

    const entries: LeaderboardEntry[] = currentEntries.map((e, index) => {
      const rank = index + 1;
      const prevRank = prevRankMap.get(e.registration_id) ?? null;

      let status: 'active' | 'eliminated' | 'qualified' = 'active';
      if (isCompleted) {
        status = rank === 1 ? 'qualified' : 'eliminated';
      } else if (isLive && currentEntries.length > 12) {
        status = rank <= 12 ? 'qualified' : 'active';
      }

      return {
        rank,
        prev_rank: prevRank,
        team_id: e.team_id,
        registration_id: e.registration_id,
        participant_name: e.participant_name,
        team_name: e.team_name,
        logo_url: e.logo_url,
        kills: e.kills,
        placement_points: e.placement_points,
        total_points: e.total_points,
        status,
        team_tag: e.team_tag,
        kill_points: e.kill_points,
        total_kills: e.total_kills,
        booyahs: e.booyahs,
        last_match_placement: e.last_match_placement,
      };
    });

    const response: LeaderboardResponse = {
      tournament_id: tournamentId,
      updated_at: new Date().toISOString(),
      round: roundName,
      entries,
    };

    // Cache in Redis (1 hour TTL)
    const cacheKey = `lb:tournament:${tournamentId}:${roundQuery || 'all'}`;
    try {
      await this.redis.client.set(cacheKey, JSON.stringify(response), 'EX', 3600);
    } catch {
      // Ignore cache write errors
    }

    // Emit event for Socket.IO gateway
    this.eventEmitter.emit('leaderboard.updated', {
      tournamentId,
      leaderboard: response,
    });

    return response;
  }

  async finalizeTournament(adminId: string, tournamentId: string): Promise<{ tournament_id: string; final_standings: LeaderboardEntry[] }> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const leaderboard = await this.rebuildLeaderboardCache(tournamentId);

    validateStatusTransition(tournament.status, TournamentStatus.COMPLETED);

    await this.prisma.$transaction(async (tx) => {
      for (const entry of leaderboard.entries) {
        await tx.tournamentRegistration.update({
          where: { id: entry.registration_id },
          data: { finalRank: entry.rank },
        });
      }

      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: TournamentStatus.COMPLETED },
      });
    });

    this.eventEmitter.emit('results.published', {
      tournamentId,
      tournamentTitle: tournament.title,
    });

    return {
      tournament_id: tournamentId,
      final_standings: leaderboard.entries,
    };
  }

  async getMatchesForTournament(tournamentId: string): Promise<Match[]> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return this.prisma.match.findMany({
      where: { tournamentId },
      include: {
        tournament: { select: { roomId: true, roomPassword: true, roomReleasedAt: true } },
        results: {
          include: {
            registration: {
              include: { user: true, team: true },
            },
          },
        },
      },
      orderBy: { matchNumber: 'asc' },
    });
  }

  async getGroupedMatchesForTournament(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          include: {
            tournament: { select: { roomId: true, roomPassword: true, roomReleasedAt: true } },
            results: {
              include: {
                registration: {
                  include: { user: true, team: true },
                },
              },
            },
          },
          orderBy: { matchNumber: 'asc' },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const rawMatches = tournament.matches;
    const mappedMatches: MatchResponse[] = rawMatches.map((m: any) => toMatchResponse(m));

    const groupsMap = new Map<string, any>();

    for (const m of mappedMatches) {
      const gName = m.group_name || m.group || 'Group A';
      if (!groupsMap.has(gName)) {
        groupsMap.set(gName, {
          group_name: gName,
          group: gName,
          room_id: m.room_id,
          room_password: m.room_password,
          password: m.password,
          is_room_released: m.is_room_released,
          matches: [],
        });
      }
      const grp = groupsMap.get(gName);
      grp.matches.push(m);
      if (m.room_id) {
        grp.room_id = m.room_id;
        grp.room_password = m.room_password;
        grp.password = m.password;
        grp.is_room_released = m.is_room_released;
      }
    }

    const groups = Array.from(groupsMap.values());

    return {
      matches: mappedMatches,
      groups,
    };
  }
}
