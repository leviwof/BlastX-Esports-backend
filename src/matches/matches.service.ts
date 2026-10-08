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

  async getGroupedMatchesForTournament(tournamentId: string, currentUserId?: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        registrations: {
          include: {
            user: true,
            team: {
              include: {
                members: {
                  include: { user: true },
                },
              },
            },
          },
        },
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
      throw new NotFoundException(`Tournament '${tournamentId}' not found`);
    }

    const maxTeamsPerGroup =
      tournament.format === TournamentFormat.CLASH_SQUAD ||
      (tournament.teamMode as string) === 'DUO' ||
      (tournament.teamMode as string) === 'SOLO'
        ? 2
        : 12;

    // Determine caller's registration status and team info
    const userReg = currentUserId
      ? tournament.registrations.find(
          (r) =>
            r.userId === currentUserId ||
            r.team?.members?.some((m) => m.userId === currentUserId),
        )
      : null;

    const isUserRegistered = !!userReg && userReg.status === RegistrationStatus.CONFIRMED;

    let userContext: any = null;
    let userTeamId: string | null = null;

    if (userReg) {
      userTeamId = userReg.teamId || userReg.userId;
      const userTeamName = userReg.team?.name || userReg.user?.name || 'My Team';

      // Find match user belongs to
      const userMatch =
        tournament.matches.find((m) =>
          m.results.some(
            (r) =>
              r.registrationId === userReg.id ||
              r.registration.teamId === userReg.teamId ||
              r.registration.userId === userReg.userId,
          ),
        ) || tournament.matches[0] || null;

      if (userMatch) {
        const isDisqualified =
          userReg.status === RegistrationStatus.DISQUALIFIED ||
          userReg.status === RegistrationStatus.CANCELLED;

        const isPublished = !!(
          userMatch.roomReleasedAt && userMatch.roomReleasedAt <= new Date()
        );

        const revealAt = userMatch.roomReleasedAt
          ? userMatch.roomReleasedAt.toISOString()
          : null;

        const startsAt = userMatch.scheduledAt
          ? userMatch.scheduledAt.toISOString()
          : null;

        // Security Guard: Room ID and Password MUST ONLY be sent to logged-in users who belong to that group AND is_published == true AND not disqualified!
        let roomId: string | null = null;
        let password: string | null = null;

        if (isUserRegistered && !isDisqualified && isPublished) {
          roomId = userMatch.roomId || tournament.roomId || null;
          password = userMatch.roomPassword || tournament.roomPassword || null;
        }

        const opponentTeamNames = userMatch.results
          .map((r) => r.registration.team?.name || r.registration.user?.name)
          .filter((name): name is string => !!name && name !== userTeamName);

        userContext = {
          team_id: userTeamId,
          team_name: userTeamName,
          round_id: userMatch.round
            ? userMatch.round.toLowerCase().replace(/\s+/g, '_')
            : 'round_1',
          round_name: userMatch.round || 'Round 1 - Qualifiers',
          group_id: userMatch.groupName
            ? userMatch.groupName.toLowerCase().replace(/\s+/g, '_')
            : 'group_101',
          group_name: userMatch.groupName || 'Group 1',
          status: userMatch.status.toLowerCase(),
          map: userMatch.map || tournament.map || 'Bermuda',
          opponent_team_names: opponentTeamNames,
          room_id: roomId,
          password: password,
          is_published: isPublished,
          reveal_at: revealAt,
          starts_at: startsAt,
        };
      }
    }

    // Build Round & Group Structure
    const roundsMap = new Map<string, any>();

    for (let i = 0; i < tournament.matches.length; i++) {
      const m = tournament.matches[i];
      const roundName = m.round || 'Round 1 - Qualifiers';
      const roundId = roundName.toLowerCase().replace(/\s+/g, '_');

      if (!roundsMap.has(roundId)) {
        roundsMap.set(roundId, {
          id: roundId,
          round_name: roundName,
          round_number: roundsMap.size + 1,
          status: m.status.toLowerCase(),
          groups: [],
        });
      }

      const currentRound = roundsMap.get(roundId);
      const isPublished = !!(m.roomReleasedAt && m.roomReleasedAt <= new Date());

      const groupTeams: any[] = m.results.map((r) => {
        const tId = r.registration.teamId || r.registration.userId;
        const tName = r.registration.team?.name || r.registration.user?.name || 'Team';
        const tLogo = r.registration.team?.logoUrl || r.registration.user?.profilePic || null;
        const isMyTeam = !!userTeamId && tId === userTeamId;

        return {
          id: tId,
          name: tName,
          logo_url: tLogo,
          is_my_team: isMyTeam,
        };
      });

      // If no match results exist yet, populate teams from tournament registrations
      if (groupTeams.length === 0 && tournament.registrations.length > 0) {
        for (const reg of tournament.registrations.slice(0, maxTeamsPerGroup)) {
          const tId = reg.teamId || reg.userId;
          const tName = reg.team?.name || reg.user?.name || 'Team';
          const tLogo = reg.team?.logoUrl || reg.user?.profilePic || null;
          const isMyTeam = !!userTeamId && tId === userTeamId;

          groupTeams.push({
            id: tId,
            name: tName,
            logo_url: tLogo,
            is_my_team: isMyTeam,
          });
        }
      }

      // SECURITY RULE: General groups list MUST ALWAYS have room_id = null and password = null!
      currentRound.groups.push({
        id: m.id || (m.groupName ? m.groupName.toLowerCase().replace(/\s+/g, '_') : `group_${i + 1}`),
        group_name: m.groupName || `Group ${currentRound.groups.length + 1}`,
        group_number: currentRound.groups.length + 1,
        map: m.map || tournament.map || 'Bermuda',
        status: m.status.toLowerCase(),
        starts_at: m.scheduledAt ? m.scheduledAt.toISOString() : null,
        ended_at: m.endedAt ? m.endedAt.toISOString() : null,
        is_published: isPublished,
        room_id: null, // SECURITY RULE: Credentials NEVER in general groups array
        password: null, // SECURITY RULE: Credentials NEVER in general groups array
        winner_team_name: m.winnerTeamName || null,
        top_mvp_name: m.topKillerName || null,
        teams: groupTeams,
      });
    }

    // Default round if no matches created yet
    if (roundsMap.size === 0) {
      const defaultTeams = tournament.registrations.map((reg) => {
        const tId = reg.teamId || reg.userId;
        const tName = reg.team?.name || reg.user?.name || 'Team';
        const tLogo = reg.team?.logoUrl || reg.user?.profilePic || null;
        const isMyTeam = !!userTeamId && tId === userTeamId;

        return {
          id: tId,
          name: tName,
          logo_url: tLogo,
          is_my_team: isMyTeam,
        };
      });

      roundsMap.set('round_1', {
        id: 'round_1',
        round_name: 'Round 1 - Qualifiers',
        round_number: 1,
        status: tournament.status.toLowerCase(),
        groups: [
          {
            id: 'group_101',
            group_name: 'Group 1',
            group_number: 1,
            map: tournament.map || 'Bermuda',
            status: tournament.status.toLowerCase(),
            starts_at: tournament.startsAt ? tournament.startsAt.toISOString() : null,
            ended_at: null,
            is_published: false,
            room_id: null,
            password: null,
            winner_team_name: null,
            top_mvp_name: null,
            teams: defaultTeams,
          },
        ],
      });
    }

    const rounds = Array.from(roundsMap.values());

    // Legacy mapped matches and groups for backwards compatibility
    const rawMatches = tournament.matches;
    const mappedMatches: MatchResponse[] = rawMatches.map((m: any) => toMatchResponse(m));
    const legacyGroupsMap = new Map<string, any>();

    for (const m of mappedMatches) {
      const gName = m.group_name || m.group || 'Group 1';
      if (!legacyGroupsMap.has(gName)) {
        legacyGroupsMap.set(gName, {
          group_name: gName,
          group: gName,
          room_id: null,
          room_password: null,
          password: null,
          is_room_released: m.is_room_released,
          matches: [],
        });
      }
      const grp = legacyGroupsMap.get(gName);
      grp.matches.push(m);
    }

    const legacyGroups = Array.from(legacyGroupsMap.values());

    return {
      status: 'success',
      tournament_id: tournamentId,
      is_user_registered: isUserRegistered,
      max_teams_per_group: maxTeamsPerGroup,
      user_context: userContext,
      rounds: rounds,
      data: mappedMatches,
      matches: mappedMatches,
      groups: legacyGroups,
    };
  }

  async createGroupMatch(adminId: string, roundId: string, dto: any): Promise<Match> {
    const groupName = dto.group_name || 'Group 1';
    const roundName = dto.round_name || roundId.replace(/_/g, ' ').toUpperCase();

    let tournamentId = dto.tournament_id;
    if (!tournamentId) {
      const firstTourn = await this.prisma.tournament.findFirst({ select: { id: true } });
      tournamentId = firstTourn?.id || 'default_tournament';
    }

    const count = await this.prisma.match.count({ where: { tournamentId } });

    return this.prisma.match.create({
      data: {
        tournamentId,
        matchNumber: count + 1,
        round: roundName,
        groupName: groupName,
        map: dto.map || 'Bermuda',
        scheduledAt: dto.starts_at ? new Date(dto.starts_at) : new Date(),
        status: MatchStatus.SCHEDULED,
      },
    });
  }

  async assignTeamsToGroup(adminId: string, groupId: string, teamIds: string[]) {
    let match = await this.prisma.match.findUnique({ where: { id: groupId } });
    if (!match) {
      match = await this.prisma.match.findFirst({ where: { groupName: groupId } });
    }
    if (!match) {
      throw new NotFoundException(`Group match '${groupId}' not found`);
    }

    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId: match.tournamentId,
        OR: [
          { teamId: { in: teamIds } },
          { userId: { in: teamIds } },
          { id: { in: teamIds } },
        ],
      },
    });

    for (const reg of registrations) {
      await this.prisma.matchResult.upsert({
        where: {
          unique_match_registration: {
            matchId: match.id,
            registrationId: reg.id,
          },
        },
        update: {},
        create: {
          matchId: match.id,
          registrationId: reg.id,
          placement: 0,
          kills: 0,
        },
      });
    }

    return {
      status: 'success',
      message: `Successfully assigned ${registrations.length} teams to group ${groupId}`,
      assigned_count: registrations.length,
    };
  }

  async setGroupRoomCredentials(adminId: string, groupId: string, dto: any) {
    let match = await this.prisma.match.findUnique({
      where: { id: groupId },
      include: { tournament: true },
    });
    if (!match) {
      match = await this.prisma.match.findFirst({
        where: { groupName: groupId },
        include: { tournament: true },
      });
    }

    if (!match) {
      throw new NotFoundException(`Group match '${groupId}' not found`);
    }

    const roomId = dto.room_id || dto.roomId;
    const password = dto.password || dto.room_password;
    const isPublished = dto.is_published ?? true;
    const releaseTime = dto.visible_from ? new Date(dto.visible_from) : new Date();

    const updatedMatch = await this.prisma.match.update({
      where: { id: match.id },
      data: {
        roomId,
        roomPassword: password,
        roomReleasedAt: isPublished ? releaseTime : null,
      },
    });

    if (isPublished) {
      this.eventEmitter.emit('room.released', {
        tournamentId: match.tournamentId,
        tournamentTitle: match.tournament?.title || 'Tournament',
        groupId: groupId,
      });
    }

    return {
      status: 'success',
      group_id: match.id,
      room_id: updatedMatch.roomId,
      password: updatedMatch.roomPassword,
      is_published: !!updatedMatch.roomReleasedAt,
      visible_from: updatedMatch.roomReleasedAt,
    };
  }

  async recordGroupResults(adminId: string, groupId: string, dto: any) {
    let match = await this.prisma.match.findUnique({ where: { id: groupId } });
    if (!match) {
      match = await this.prisma.match.findFirst({ where: { groupName: groupId } });
    }

    if (match) {
      await this.prisma.match.update({
        where: { id: match.id },
        data: {
          winnerTeamName: dto.winner_team_name || dto.winner_team_id || null,
          topKillerName: dto.top_mvp_name || null,
          status: MatchStatus.COMPLETED,
        },
      });

      if (dto.team_scores && Array.isArray(dto.team_scores)) {
        for (const score of dto.team_scores) {
          const reg = await this.prisma.tournamentRegistration.findFirst({
            where: {
              tournamentId: match.tournamentId,
              OR: [{ teamId: score.team_id }, { userId: score.team_id }, { id: score.team_id }],
            },
          });
          if (reg) {
            await this.prisma.matchResult.upsert({
              where: {
                unique_match_registration: {
                  matchId: match.id,
                  registrationId: reg.id,
                },
              },
              update: {
                kills: score.kills || 0,
                placementPoints: score.placement_points || 0,
                totalPoints: score.total_points || (score.kills || 0) + (score.placement_points || 0),
              },
              create: {
                matchId: match.id,
                registrationId: reg.id,
                placement: score.placement || 1,
                kills: score.kills || 0,
                placementPoints: score.placement_points || 0,
                totalPoints: score.total_points || (score.kills || 0) + (score.placement_points || 0),
              },
            });
          }
        }
      }

      await this.rebuildLeaderboardCache(match.tournamentId);

      return {
        status: 'success',
        message: `Results recorded for group ${groupId}`,
      };
    }

    if (dto.results) {
      return this.recordMatchResults(adminId, groupId, dto);
    }

    throw new NotFoundException(`Group match '${groupId}' not found`);
  }

  async updateTeamStatusInTournament(adminId: string, tournamentId: string, teamId: string, statusInput: string) {
    const statusMap: Record<string, RegistrationStatus> = {
      QUALIFIED: RegistrationStatus.CONFIRMED,
      DISQUALIFIED: RegistrationStatus.DISQUALIFIED,
      ELIMINATED: RegistrationStatus.CANCELLED,
      REGISTERED: RegistrationStatus.CONFIRMED,
    };

    const targetStatus = statusMap[statusInput.toUpperCase()] || RegistrationStatus.CONFIRMED;

    const reg = await this.prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        OR: [{ teamId }, { userId: teamId }, { id: teamId }],
      },
    });

    if (!reg) {
      throw new NotFoundException(`Team '${teamId}' registration in tournament '${tournamentId}' not found`);
    }

    const updated = await this.prisma.tournamentRegistration.update({
      where: { id: reg.id },
      data: { status: targetStatus },
    });

    return {
      status: 'success',
      team_id: teamId,
      tournament_id: tournamentId,
      registration_status: updated.status,
    };
  }
}
