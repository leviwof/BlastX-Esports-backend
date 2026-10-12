import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  OwnerRole,
  TeamMemberRole,
  RegistrationStatus,
  QualificationDestination,
  Tournament,
  Team,
  TeamMember,
  TournamentRegistration,
  User,
  Match,
  TournamentGroup,
  TournamentRound,
  TournamentStatus,
  RoundStatus,
} from '@prisma/client';

export type MatchAccessType = 'PLAYING' | 'NON_PLAYING' | 'NONE';

export interface MyAccessResult {
  registration:
    | (TournamentRegistration & {
        team?: (Team & { members: TeamMember[] }) | null;
        user?: User | null;
      })
    | null;
  team: (Team & { members: TeamMember[] }) | null;
  role: string | null;
  access: MatchAccessType;
  isEliminated: boolean;
  isDisqualified: boolean;
  eliminatedInRound?: string | null;
  eliminatedInRoundNumber?: number | null;
  finalRank?: number | null;
}

export interface MatchUnit {
  matchKey: string; // 'm_<matches.id>' or 'g_<tournament_groups.id>'
  tournamentId: string;
  matchId?: string;
  groupId?: string;
  roundId?: string;
  roundKey: string;
  roundName: string;
  roundType?: string | null;
  roundNumber?: number;
  groupName: string;
  matchNumber: number;
  map: string;
  status: string;
  scheduledAt: Date;
  streamUrl?: string | null;
  winnerTeamName?: string | null;
  topKillerName?: string | null;
  matchRoomId?: string | null;
  matchRoomPassword?: string | null;
  matchRoomReleasedAt?: Date | null;
  groupRoomId?: string | null;
  groupRoomPassword?: string | null;
  groupReleasedAt?: Date | null;
  participatingTeamIds: string[] | null; // null means single-lobby (all confirmed participate)
  participatingRegIds: string[];
  results: Array<{
    id: string;
    registrationId: string;
    teamId?: string | null;
    userId?: string | null;
    placement: number;
    kills: number;
    placementPoints: number;
    killPoints: number;
    totalPoints: number;
  }>;
}

export interface ResolvedCredentials {
  roomId: string | null;
  roomPassword: string | null;
  releasedAt: Date | null;
  isReleased: boolean;
  source: 'match' | 'group' | 'tournament' | 'none';
}

export interface MatchCenterStatus {
  state: 'ACTIVE' | 'QUALIFIED' | 'ELIMINATED' | 'DISQUALIFIED' | 'COMPLETED';
  current_round: string;
  eliminated_in_round: string | null;
  final_rank: number | null;
  rank: number | null;
  total_points: number;
  total_kills: number;
}

export interface MatchCenterMatch {
  match_key: string;
  match_number: number;
  group_name: string;
  map: string;
  status: string;
  scheduled_at: string;
  room_state: 'HIDDEN' | 'PUBLISHED' | 'NOT_ELIGIBLE';
  room_reveal_at: string | null;
  my_result: {
    placement: number;
    kills: number;
    total_points: number;
  } | null;
  recording_status:
    | 'NONE'
    | 'PENDING_UPLOAD'
    | 'UPLOADING'
    | 'UPLOADED'
    | 'FAILED'
    | 'REJECTED';
}

export interface MatchCenterRound {
  key: string;
  name: string;
  round_type: string;
  status: string;
  matches: MatchCenterMatch[];
}

export interface MatchCenterResponse {
  tournament_id: string;
  my_access: MatchAccessType;
  my_role: string | null;
  my_status: MatchCenterStatus;
  rounds: MatchCenterRound[];
}

export interface MatchDetailResponse {
  match_key: string;
  match_number: number;
  group_name: string;
  map: string;
  status: string;
  scheduled_at: string;
  stream_url: string | null;
  room_state: 'HIDDEN' | 'PUBLISHED' | 'NOT_ELIGIBLE';
  room_reveal_at: string | null;
  my_result: {
    placement: number;
    kills: number;
    total_points: number;
  } | null;
  recording_status:
    | 'NONE'
    | 'PENDING_UPLOAD'
    | 'UPLOADING'
    | 'UPLOADED'
    | 'FAILED'
    | 'REJECTED';
}

@Injectable()
export class MatchAccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Playing members of a team in a tournament =
   * team_members with role CAPTAIN (only when team.owner_role = LEADER) or PLAYER.
   * MANAGER and SUBSTITUTE are never playing.
   * SOLO: the registrant. DUO: both main players.
   */
  async getPlayingMemberIds(teamId: string): Promise<string[]> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true },
    });
    if (!team) return [];

    return this.filterPlayingMemberIds(team);
  }

  filterPlayingMemberIds(team: Team & { members: TeamMember[] }): string[] {
    const isLeaderOwner = team.ownerRole === OwnerRole.LEADER;
    return team.members
      .filter((m) => {
        if (m.role === TeamMemberRole.PLAYER) return true;
        if (m.role === TeamMemberRole.CAPTAIN && isLeaderOwner) return true;
        // MANAGER and SUBSTITUTE are never playing
        return false;
      })
      .map((m) => m.userId);
  }

  /**
   * Evaluates the caller's registration, team, role, and access level.
   */
  async getMyAccess(userId: string, tournamentId: string): Promise<MyAccessResult> {
    const reg = await this.prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        OR: [
          { userId },
          {
            team: {
              members: {
                some: { userId },
              },
            },
          },
        ],
      },
      include: {
        team: {
          include: {
            members: true,
          },
        },
        user: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!reg) {
      return {
        registration: null,
        team: null,
        role: null,
        access: 'NONE',
        isEliminated: false,
        isDisqualified: false,
      };
    }

    const isDisqualified = reg.status === RegistrationStatus.DISQUALIFIED;
    const isCancelled = reg.status === RegistrationStatus.CANCELLED;
    const isWaitlist = reg.status === RegistrationStatus.WAITLIST;

    if (isCancelled || isWaitlist) {
      return {
        registration: reg,
        team: reg.team ?? null,
        role: null,
        access: 'NONE',
        isEliminated: false,
        isDisqualified: false,
      };
    }

    let role: string | null = null;
    let access: MatchAccessType = 'NONE';
    let isEliminated = isDisqualified;
    let eliminatedInRound: string | null = null;
    let eliminatedInRoundNumber: number | null = null;

    if (reg.team) {
      const member = reg.team.members.find((m) => m.userId === userId);
      role = member?.role ?? null;

      const playingIds = this.filterPlayingMemberIds(reg.team);
      const isPlaying = playingIds.includes(userId);

      access = isPlaying ? 'PLAYING' : 'NON_PLAYING';

      // Check round qualifications for elimination
      const qualifications = await this.prisma.roundQualification.findMany({
        where: {
          tournamentTeamId: reg.team.id,
          round: { tournamentId },
        },
        include: { round: true },
        orderBy: { createdAt: 'desc' },
      });

      const eliminatedQual = qualifications.find(
        (q) => q.destination === QualificationDestination.ELIMINATED,
      );
      if (eliminatedQual) {
        isEliminated = true;
        eliminatedInRound = eliminatedQual.round?.roundType
          ? this.formatRoundType(eliminatedQual.round.roundType)
          : `Round ${eliminatedQual.round?.roundNumber}`;
        eliminatedInRoundNumber = eliminatedQual.round?.roundNumber ?? null;
      }
    } else {
      // SOLO tournament
      if (reg.userId === userId) {
        role = 'PLAYER';
        access = 'PLAYING';
      }
    }

    return {
      registration: reg,
      team: reg.team ?? null,
      role,
      access,
      isEliminated,
      isDisqualified,
      eliminatedInRound,
      eliminatedInRoundNumber,
    };
  }

  /**
   * Enumerates all MatchUnits for a tournament (matches table and orphan groups).
   */
  async listMatchUnits(
    tournamentId: string,
    teamId?: string,
  ): Promise<MatchUnit[]> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          include: {
            group: {
              include: {
                groupTeams: true,
                round: true,
              },
            },
            results: {
              include: {
                registration: true,
              },
            },
          },
          orderBy: { matchNumber: 'asc' },
        },
        rounds: {
          include: {
            groups: {
              include: {
                groupTeams: true,
                matches: true,
              },
            },
          },
          orderBy: { roundNumber: 'asc' },
        },
      },
    });

    if (!tournament) return [];

    const units: MatchUnit[] = [];

    // 1. Matches from the matches table
    for (const m of tournament.matches) {
      const matchKey = `m_${m.id}`;
      const roundKey = m.group?.round
        ? m.group.round.roundType.toLowerCase()
        : m.round
          ? m.round.toLowerCase().replace(/\s+/g, '_')
          : 'round_1';

      const roundName = m.group?.round?.roundType
        ? this.formatRoundType(m.group.round.roundType)
        : m.round || `Round ${m.matchNumber}`;

      let participatingTeamIds: string[] | null = null;
      let participatingRegIds: string[] = [];

      if (m.groupId && m.group?.groupTeams && m.group.groupTeams.length > 0) {
        participatingTeamIds = m.group.groupTeams.map(
          (gt) => gt.tournamentTeamId,
        );
      } else if (m.results && m.results.length > 0) {
        participatingTeamIds = m.results
          .map((r) => r.registration?.teamId || r.registration?.userId)
          .filter((id): id is string => !!id);
        participatingRegIds = m.results.map((r) => r.registrationId);
      }

      const results = (m.results || []).map((r) => ({
        id: r.id,
        registrationId: r.registrationId,
        teamId: r.registration?.teamId ?? null,
        userId: r.registration?.userId ?? null,
        placement: r.placement,
        kills: r.kills,
        placementPoints: r.placementPoints,
        killPoints: r.killPoints,
        totalPoints: r.totalPoints,
      }));

      units.push({
        matchKey,
        tournamentId,
        matchId: m.id,
        groupId: m.groupId ?? undefined,
        roundId: m.group?.roundId,
        roundKey,
        roundName,
        roundType: m.group?.round?.roundType ?? null,
        roundNumber: m.group?.round?.roundNumber,
        groupName: m.group?.name || m.groupName || 'Group 1',
        matchNumber: m.matchNumber,
        map: m.map || tournament.map || 'Bermuda',
        status: m.status,
        scheduledAt: m.scheduledAt,
        streamUrl: m.streamUrl,
        winnerTeamName: m.winnerTeamName,
        topKillerName: m.topKillerName,
        matchRoomId: m.roomId,
        matchRoomPassword: m.roomPassword,
        matchRoomReleasedAt: m.roomReleasedAt,
        groupRoomId: m.group?.roomId,
        groupRoomPassword: m.group?.roomPassword,
        groupReleasedAt: m.group?.credentialsReleasedAt,
        participatingTeamIds,
        participatingRegIds,
        results,
      });
    }

    // 2. Orphan tournament_groups with no linked matches row
    for (const round of tournament.rounds) {
      for (const group of (round.groups || [])) {
        if (!group.matches || group.matches.length === 0) {
          const matchKey = `g_${group.id}`;
          const roundKey = round.roundType.toLowerCase();
          const roundName = this.formatRoundType(round.roundType);

          const participatingTeamIds = (group.groupTeams || []).map(
            (gt) => gt.tournamentTeamId,
          );

          units.push({
            matchKey,
            tournamentId,
            groupId: group.id,
            roundId: round.id,
            roundKey,
            roundName,
            roundType: round.roundType,
            roundNumber: round.roundNumber,
            groupName: group.name,
            matchNumber: group.groupNumber,
            map: tournament.map || 'Bermuda',
            status: round.status,
            scheduledAt: round.startedAt || tournament.startsAt,
            groupRoomId: group.roomId,
            groupRoomPassword: group.roomPassword,
            groupReleasedAt: group.credentialsReleasedAt,
            participatingTeamIds,
            participatingRegIds: [],
            results: [],
          });
        }
      }
    }

    return units;
  }

  /**
   * Checks whether a team or solo registration participates in a MatchUnit:
   * 1. match has group_id -> team is in tournament_group_teams
   * 2. match_results exist -> team/user registration is in match_results
   * 3. single-lobby -> every CONFIRMED team participates
   */
  teamParticipatesInMatchUnit(
    unit: MatchUnit,
    teamId: string | null,
    userId: string,
    registrationId?: string,
  ): boolean {
    if (unit.participatingTeamIds !== null) {
      if (teamId) {
        return unit.participatingTeamIds.includes(teamId);
      }
      return unit.participatingTeamIds.includes(userId);
    }

    // If unit has specific match_results, check if registration or team/user is in results
    if (unit.results.length > 0) {
      return unit.results.some(
        (r) =>
          (registrationId && r.registrationId === registrationId) ||
          (teamId && r.teamId === teamId) ||
          r.userId === userId,
      );
    }

    // Single-lobby tournaments: every CONFIRMED team participates
    return true;
  }

  /**
   * Credentials resolve in this order:
   * match.room_id/password (released) ->
   * group credentials (released) ->
   * tournament-level room (released).
   * "Released" = released_at is set and <= now.
   */
  resolveCredentials(
    matchUnit: MatchUnit,
    tournament: {
      startsAt: Date;
      roomId: string | null;
      roomPassword: string | null;
      roomReleasedAt: Date | null;
    },
    team?: Team | null,
  ): ResolvedCredentials {
    const now = new Date();

    // 1. Match-level credentials
    if (matchUnit.matchRoomId && matchUnit.matchRoomPassword) {
      const releasedAt = matchUnit.matchRoomReleasedAt;
      const isReleased = !!(releasedAt && releasedAt <= now);
      return {
        roomId: isReleased ? matchUnit.matchRoomId : null,
        roomPassword: isReleased ? matchUnit.matchRoomPassword : null,
        releasedAt: releasedAt ?? null,
        isReleased,
        source: 'match',
      };
    }

    // 2. Group-level credentials
    if (matchUnit.groupRoomId && matchUnit.groupRoomPassword) {
      const releasedAt = matchUnit.groupReleasedAt;
      const isReleased = !!(releasedAt && releasedAt <= now);
      return {
        roomId: isReleased ? matchUnit.groupRoomId : null,
        roomPassword: isReleased ? matchUnit.groupRoomPassword : null,
        releasedAt: releasedAt ?? null,
        isReleased,
        source: 'group',
      };
    }

    // 3. Tournament-level credentials
    if (tournament.roomId && tournament.roomPassword) {
      const releasedAt =
        tournament.roomReleasedAt ??
        new Date(tournament.startsAt.getTime() - 15 * 60 * 1000);
      const isReleased = !!(releasedAt && releasedAt <= now);
      return {
        roomId: isReleased ? tournament.roomId : null,
        roomPassword: isReleased ? tournament.roomPassword : null,
        releasedAt,
        isReleased,
        source: 'tournament',
      };
    }

    const defaultRevealAt =
      tournament.roomReleasedAt ??
      new Date(tournament.startsAt.getTime() - 15 * 60 * 1000);

    return {
      roomId: null,
      roomPassword: null,
      releasedAt: defaultRevealAt,
      isReleased: false,
      source: 'none',
    };
  }

  /**
   * Validates access and returns credentials for a matchKey.
   * Throws strictly specified errors:
   * - 403 NOT_REGISTERED
   * - 403 NOT_PLAYING_MEMBER
   * - 403 ELIMINATED
   * - 403 NOT_IN_THIS_MATCH
   * - 425 ROOM_NOT_AVAILABLE (with reveal_at)
   * - 404 MATCH_NOT_FOUND
   */
  async assertCanSeeCredentials(
    userId: string,
    matchKey: string,
    tournamentIdParam?: string,
  ): Promise<{
    room_id: string;
    room_password: string;
    visible_from: Date;
    scheduled_at: Date;
  }> {
    // 1. Resolve MatchUnit
    let targetTournamentId = tournamentIdParam;
    let matchUnit: MatchUnit | undefined;

    if (targetTournamentId) {
      const units = await this.listMatchUnits(targetTournamentId);
      matchUnit = units.find((u) => u.matchKey === matchKey);
    } else {
      // Find tournamentId by matchKey
      if (matchKey.startsWith('m_')) {
        const m = await this.prisma.match.findUnique({
          where: { id: matchKey.replace('m_', '') },
          select: { tournamentId: true },
        });
        if (m) targetTournamentId = m.tournamentId;
      } else if (matchKey.startsWith('g_')) {
        const g = await this.prisma.tournamentGroup.findUnique({
          where: { id: matchKey.replace('g_', '') },
          include: { round: true },
        });
        if (g) targetTournamentId = g.round.tournamentId;
      }

      if (targetTournamentId) {
        const units = await this.listMatchUnits(targetTournamentId);
        matchUnit = units.find((u) => u.matchKey === matchKey);
      }
    }

    if (!matchUnit || !targetTournamentId) {
      throw new HttpException(
        { code: 'MATCH_NOT_FOUND', message: `Match '${matchKey}' not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: targetTournamentId },
    });
    if (!tournament) {
      throw new HttpException(
        { code: 'MATCH_NOT_FOUND', message: 'Tournament not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // 2. Validate user registration and access
    const myAccess = await this.getMyAccess(userId, targetTournamentId);

    if (
      !myAccess.registration ||
      myAccess.registration.status !== RegistrationStatus.CONFIRMED
    ) {
      throw new HttpException(
        {
          code: 'NOT_REGISTERED',
          message: 'You are not registered for this tournament.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (myAccess.access !== 'PLAYING') {
      throw new HttpException(
        {
          code: 'NOT_PLAYING_MEMBER',
          message:
            'Only active playing members of the roster can access room credentials.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (myAccess.isDisqualified) {
      throw new HttpException(
        {
          code: 'ELIMINATED',
          message: 'Your registration has been disqualified.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 3. Check participation in this match
    const teamId = myAccess.team?.id ?? null;
    const participates = this.teamParticipatesInMatchUnit(
      matchUnit,
      teamId,
      userId,
      myAccess.registration.id,
    );

    if (!participates) {
      if (myAccess.isEliminated) {
        throw new HttpException(
          {
            code: 'ELIMINATED',
            message: 'Your team has been eliminated from this tournament.',
          },
          HttpStatus.FORBIDDEN,
        );
      }
      throw new HttpException(
        {
          code: 'NOT_IN_THIS_MATCH',
          message: 'Your team is not assigned to this match.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 4. Check if team is eliminated from later stages
    if (myAccess.isEliminated) {
      // If eliminated in an earlier round, block access to later rounds
      if (
        myAccess.eliminatedInRoundNumber &&
        matchUnit.roundNumber &&
        matchUnit.roundNumber > myAccess.eliminatedInRoundNumber
      ) {
        throw new HttpException(
          {
            code: 'ELIMINATED',
            message: 'Your team has been eliminated from this tournament.',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 5. Resolve credentials
    const creds = this.resolveCredentials(
      matchUnit,
      tournament,
      myAccess.team,
    );

    if (!creds.isReleased || !creds.roomId || !creds.roomPassword) {
      const revealAt = creds.releasedAt
        ? creds.releasedAt.toISOString()
        : tournament.startsAt.toISOString();

      throw new HttpException(
        {
          code: 'ROOM_NOT_AVAILABLE',
          message: 'Room credentials have not yet been released.',
          reveal_at: revealAt,
        },
        425,
      );
    }

    return {
      room_id: creds.roomId,
      room_password: creds.roomPassword,
      visible_from: creds.releasedAt!,
      scheduled_at: matchUnit.scheduledAt,
    };
  }

  /**
   * Match Center API - GET /v1/tournaments/:id/match-center
   */
  async getMatchCenter(
    tournamentId: string,
    userId: string,
  ): Promise<MatchCenterResponse> {
    const myAccess = await this.getMyAccess(userId, tournamentId);

    if (
      !myAccess.registration ||
      myAccess.registration.status !== RegistrationStatus.CONFIRMED
    ) {
      throw new HttpException(
        {
          code: 'NOT_REGISTERED',
          message: 'You are not registered for this tournament.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // Batch query: rounds, match units, qualifications, official results, and recordings
    const [units, qualifications, groupTeams, userResults, userRecordings] =
      await Promise.all([
        this.listMatchUnits(tournamentId),
        myAccess.team
          ? this.prisma.roundQualification.findMany({
              where: {
                tournamentTeamId: myAccess.team.id,
                round: { tournamentId },
              },
              include: { round: true },
              orderBy: { createdAt: 'desc' },
            })
          : Promise.resolve([] as any[]),
        myAccess.team
          ? this.prisma.tournamentGroupTeam.findMany({
              where: {
                tournamentTeamId: myAccess.team.id,
                group: { round: { tournamentId } },
              },
              include: {
                group: { include: { round: true } },
              },
            })
          : Promise.resolve([] as any[]),
        this.prisma.matchResult.findMany({
          where: {
            registrationId: myAccess.registration.id,
            match: { tournamentId },
          },
          include: { match: true },
        }),
        this.prisma.matchRecording?.findMany
          ? this.prisma.matchRecording.findMany({
              where: {
                tournamentId,
                userId,
              },
            })
          : Promise.resolve([] as any[]),
      ]);

    const groupTeamsList: any[] = groupTeams as any[];

    // Calculate totals from official data
    let totalKills = userResults.reduce((acc, r) => acc + (r.kills || 0), 0);
    let totalPoints = userResults.reduce(
      (acc, r) => acc + (r.totalPoints || 0),
      0,
    );

    if (totalPoints === 0 && groupTeamsList.length > 0) {
      totalKills = groupTeamsList.reduce((acc: number, gt: any) => acc + (gt.kills || 0), 0);
      totalPoints = groupTeamsList.reduce(
        (acc: number, gt: any) => acc + (gt.totalPoints || 0),
        0,
      );
    }

    // Determine current rank and final rank
    let rank: number | null = null;
    let finalRank: number | null = null;

    if (groupTeamsList.length > 0) {
      const latestGt = groupTeamsList[groupTeamsList.length - 1];
      if (latestGt.rank) rank = latestGt.rank;
    }

    if (tournament.status === TournamentStatus.COMPLETED) {
      finalRank = rank;
    }

    // Determine active round name
    let currentRound = 'Round 1';
    const activeUnit =
      units.find((u) => u.status === 'LIVE' || u.status === 'SCHEDULED') ||
      units[units.length - 1];
    if (activeUnit) {
      currentRound = activeUnit.roundName;
    }

    // Determine state
    let state: MatchCenterStatus['state'] = 'ACTIVE';
    if (myAccess.isDisqualified) {
      state = 'DISQUALIFIED';
    } else if (myAccess.isEliminated) {
      state = 'ELIMINATED';
    } else if (tournament.status === TournamentStatus.COMPLETED) {
      state = 'COMPLETED';
    } else if (
      (qualifications as any[]).some(
        (q: any) => q.destination !== QualificationDestination.ELIMINATED,
      )
    ) {
      state = 'QUALIFIED';
    }

    const myStatus: MatchCenterStatus = {
      state,
      current_round: currentRound,
      eliminated_in_round: myAccess.eliminatedInRound ?? null,
      final_rank: finalRank,
      rank,
      total_points: totalPoints,
      total_kills: totalKills,
    };

    // Group match units by rounds
    const roundsMap = new Map<string, MatchCenterRound>();

    for (const unit of units) {
      const rKey = unit.roundKey;
      if (!roundsMap.has(rKey)) {
        roundsMap.set(rKey, {
          key: rKey,
          name: unit.roundName,
          round_type: unit.roundType || rKey.toUpperCase(),
          status: unit.status,
          matches: [],
        });
      }

      const rnd = roundsMap.get(rKey)!;

      // Participation check
      const participates = this.teamParticipatesInMatchUnit(
        unit,
        myAccess.team?.id ?? null,
        userId,
        myAccess.registration.id,
      );

      // Determine room_state
      let roomState: 'HIDDEN' | 'PUBLISHED' | 'NOT_ELIGIBLE' = 'NOT_ELIGIBLE';

      if (myAccess.access === 'PLAYING' && participates) {
        // If team was eliminated in an earlier round, later rounds are NOT_ELIGIBLE
        const isPastElimination =
          myAccess.isEliminated &&
          myAccess.eliminatedInRoundNumber &&
          unit.roundNumber &&
          unit.roundNumber > myAccess.eliminatedInRoundNumber;

        if (isPastElimination) {
          roomState = 'NOT_ELIGIBLE';
        } else {
          const creds = this.resolveCredentials(
            unit,
            tournament,
            myAccess.team,
          );
          roomState = creds.isReleased ? 'PUBLISHED' : 'HIDDEN';
        }
      }

      const creds = this.resolveCredentials(unit, tournament, myAccess.team);
      const roomRevealAt = creds.releasedAt
        ? creds.releasedAt.toISOString()
        : null;

      // Result of caller's team in this match
      let myResult: MatchCenterMatch['my_result'] = null;
      if (unit.matchId) {
        const ur = userResults.find((r) => r.matchId === unit.matchId);
        if (ur) {
          myResult = {
            placement: ur.placement,
            kills: ur.kills,
            total_points: ur.totalPoints,
          };
        }
      }
      if (!myResult && unit.groupId) {
        const gt = groupTeamsList.find((g: any) => g.groupId === unit.groupId);
        if (gt && (gt.kills > 0 || gt.totalPoints > 0 || gt.rank)) {
          myResult = {
            placement: gt.rank ?? 0,
            kills: gt.kills,
            total_points: gt.totalPoints,
          };
        }
      }

      const userRec = (userRecordings as any[]).find(
        (rec) => rec.matchKey === unit.matchKey,
      );
      const recordingStatus = userRec ? userRec.status : 'NONE';

      rnd.matches.push({
        match_key: unit.matchKey,
        match_number: unit.matchNumber,
        group_name: unit.groupName,
        map: unit.map,
        status: unit.status,
        scheduled_at: unit.scheduledAt.toISOString(),
        room_state: roomState,
        room_reveal_at: roomRevealAt,
        my_result: myResult,
        recording_status: recordingStatus,
      });
    }

    // Default round if no matches exist yet
    if (roundsMap.size === 0) {
      const defaultCreds = this.resolveCredentials(
        {
          matchKey: 'default',
          tournamentId,
          groupName: 'Group 1',
          roundKey: 'round_1',
          roundName: 'Round 1 - Qualifiers',
          matchNumber: 1,
          map: tournament.map || 'Bermuda',
          status: tournament.status,
          scheduledAt: tournament.startsAt,
          participatingTeamIds: null,
          participatingRegIds: [],
          results: [],
        },
        tournament,
        myAccess.team,
      );

      const isEligible = myAccess.access === 'PLAYING' && !myAccess.isEliminated;

      roundsMap.set('round_1', {
        key: 'round_1',
        name: 'Round 1 - Qualifiers',
        round_type: 'ROUND_1',
        status: tournament.status,
        matches: [
          {
            match_key: `t_${tournament.id}`,
            match_number: 1,
            group_name: 'Group 1',
            map: tournament.map || 'Bermuda',
            status: tournament.status,
            scheduled_at: tournament.startsAt.toISOString(),
            room_state: isEligible
              ? defaultCreds.isReleased
                ? 'PUBLISHED'
                : 'HIDDEN'
              : 'NOT_ELIGIBLE',
            room_reveal_at: defaultCreds.releasedAt
              ? defaultCreds.releasedAt.toISOString()
              : null,
            my_result: null,
            recording_status:
              ((userRecordings as any[]).find(
                (rec) => rec.matchKey === `t_${tournament.id}`,
              )?.status as any) || 'NONE',
          },
        ],
      });
    }

    return {
      tournament_id: tournamentId,
      my_access: myAccess.access,
      my_role: myAccess.role,
      my_status: myStatus,
      rounds: Array.from(roundsMap.values()),
    };
  }

  /**
   * Match Detail API - GET /v1/tournaments/:id/matches/:matchKey
   */
  async getMatchDetail(
    tournamentId: string,
    matchKey: string,
    userId: string,
  ): Promise<MatchDetailResponse> {
    const myAccess = await this.getMyAccess(userId, tournamentId);

    if (
      !myAccess.registration ||
      myAccess.registration.status !== RegistrationStatus.CONFIRMED
    ) {
      throw new HttpException(
        {
          code: 'NOT_REGISTERED',
          message: 'You are not registered for this tournament.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const units = await this.listMatchUnits(tournamentId);
    const unit = units.find((u) => u.matchKey === matchKey);

    if (!unit) {
      throw new HttpException(
        { code: 'MATCH_NOT_FOUND', message: `Match '${matchKey}' not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    const participates = this.teamParticipatesInMatchUnit(
      unit,
      myAccess.team?.id ?? null,
      userId,
      myAccess.registration.id,
    );

    let roomState: 'HIDDEN' | 'PUBLISHED' | 'NOT_ELIGIBLE' = 'NOT_ELIGIBLE';

    if (myAccess.access === 'PLAYING' && participates) {
      const isPastElimination =
        myAccess.isEliminated &&
        myAccess.eliminatedInRoundNumber &&
        unit.roundNumber &&
        unit.roundNumber > myAccess.eliminatedInRoundNumber;

      if (isPastElimination) {
        roomState = 'NOT_ELIGIBLE';
      } else {
        const creds = this.resolveCredentials(
          unit,
          tournament,
          myAccess.team,
        );
        roomState = creds.isReleased ? 'PUBLISHED' : 'HIDDEN';
      }
    }

    const creds = this.resolveCredentials(unit, tournament, myAccess.team);
    const roomRevealAt = creds.releasedAt
      ? creds.releasedAt.toISOString()
      : null;

    let myResult: MatchDetailResponse['my_result'] = null;
    if (unit.matchId) {
      const ur = await this.prisma.matchResult.findUnique({
        where: {
          unique_match_registration: {
            matchId: unit.matchId,
            registrationId: myAccess.registration.id,
          },
        },
      });
      if (ur) {
        myResult = {
          placement: ur.placement,
          kills: ur.kills,
          total_points: ur.totalPoints,
        };
      }
    }
    if (!myResult && unit.groupId && myAccess.team) {
      const gt = await this.prisma.tournamentGroupTeam.findUnique({
        where: {
          groupId_tournamentTeamId: {
            groupId: unit.groupId,
            tournamentTeamId: myAccess.team.id,
          },
        },
      });
      if (gt && (gt.kills > 0 || gt.totalPoints > 0 || gt.rank)) {
        myResult = {
          placement: gt.rank ?? 0,
          kills: gt.kills,
          total_points: gt.totalPoints,
        };
      }
    }

    const userRec = this.prisma.matchRecording?.findFirst
      ? await this.prisma.matchRecording.findFirst({
          where: {
            tournamentId,
            matchKey,
            userId,
          },
        })
      : null;
    const recordingStatus = userRec ? userRec.status : 'NONE';

    return {
      match_key: unit.matchKey,
      match_number: unit.matchNumber,
      group_name: unit.groupName,
      map: unit.map,
      status: unit.status,
      scheduled_at: unit.scheduledAt.toISOString(),
      stream_url: unit.streamUrl ?? null,
      room_state: roomState,
      room_reveal_at: roomRevealAt,
      my_result: myResult,
      recording_status: recordingStatus,
    };
  }

  private formatRoundType(roundType: string): string {
    switch (roundType) {
      case 'ROUND_1':
        return 'Round 1 - Qualifiers';
      case 'ROUND_2':
        return 'Round 2 - Quarter Finals';
      case 'ROUND_3':
        return 'Round 3 - Semi Finals';
      case 'GRAND_FINAL':
        return 'Grand Final';
      default:
        return roundType.replace(/_/g, ' ');
    }
  }
}
