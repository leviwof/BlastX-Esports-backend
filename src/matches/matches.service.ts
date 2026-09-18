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
import { LeaderboardEntry } from './match.mapper';
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

  async getLeaderboard(tournamentId: string): Promise<LeaderboardEntry[]> {
    const cacheKey = `lb:tournament:${tournamentId}`;
    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Fallback to DB if Redis fails/offline
    }

    return this.rebuildLeaderboardCache(tournamentId);
  }

  async rebuildLeaderboardCache(tournamentId: string): Promise<LeaderboardEntry[]> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
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

    const entries: Omit<LeaderboardEntry, 'rank'>[] = registrations.map((reg) => {
      const totalPoints = reg.matchResults.reduce((acc, r) => acc + r.totalPoints, 0);
      const placementPoints = reg.matchResults.reduce((acc, r) => acc + r.placementPoints, 0);
      const killPoints = reg.matchResults.reduce((acc, r) => acc + r.killPoints, 0);
      const totalKills = reg.matchResults.reduce((acc, r) => acc + r.kills, 0);
      const booyahs = reg.matchResults.filter((r) => r.placement === 1).length;
      const lastMatchPlacement = reg.matchResults.length > 0 ? reg.matchResults[0].placement : 999;

      const participantName = reg.team ? reg.team.name : reg.user.name;

      return {
        registration_id: reg.id,
        participant_name: participantName,
        team_name: reg.team?.name || null,
        team_tag: reg.team?.tag || null,
        total_points: totalPoints,
        placement_points: placementPoints,
        kill_points: killPoints,
        total_kills: totalKills,
        booyahs,
        last_match_placement: lastMatchPlacement,
      };
    });

    // Sort by tie-breaker rules:
    // 1. total_points desc
    // 2. booyahs desc
    // 3. total_kills desc
    // 4. last_match_placement asc
    entries.sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      if (b.booyahs !== a.booyahs) return b.booyahs - a.booyahs;
      if (b.total_kills !== a.total_kills) return b.total_kills - a.total_kills;
      return a.last_match_placement - b.last_match_placement;
    });

    const leaderboard: LeaderboardEntry[] = entries.map((e, index) => ({
      rank: index + 1,
      ...e,
    }));

    // Cache in Redis (1 hour TTL)
    const cacheKey = `lb:tournament:${tournamentId}`;
    try {
      await this.redis.client.set(cacheKey, JSON.stringify(leaderboard), 'EX', 3600);
    } catch {
      // Ignore cache write errors
    }

    // Emit event for Socket.IO gateway
    this.eventEmitter.emit('leaderboard.updated', {
      tournamentId,
      leaderboard,
    });

    return leaderboard;
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
      for (const entry of leaderboard) {
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
      final_standings: leaderboard,
    };
  }

  async getMatchesForTournament(tournamentId: string): Promise<Match[]> {
    return this.prisma.match.findMany({
      where: { tournamentId },
      include: {
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
}
