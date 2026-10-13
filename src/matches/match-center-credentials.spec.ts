jest.mock('@nestjs/event-emitter', () => ({
  EventEmitter2: class MockEventEmitter {
    emit = jest.fn();
  },
  OnEvent: () => () => {},
}));

jest.mock('@nestjs/config', () => ({
  ConfigService: class MockConfigService {
    get = jest.fn();
  },
}));

import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { MatchAccessService, MatchUnit } from './match-access.service';
import { toMatchResponse } from './match.mapper';
import {
  OwnerRole,
  TeamMemberRole,
  RegistrationStatus,
  QualificationDestination,
  TournamentStatus,
  MatchStatus,
  RoundStatus,
  TournamentFormat,
  TeamMode,
} from '@prisma/client';

describe('Section 5: Match Center & Room Credentials Access Control', () => {
  let matchAccessService: MatchAccessService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      team: {
        findUnique: jest.fn(),
      },
      tournament: {
        findUnique: jest.fn(),
      },
      tournamentRegistration: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      roundQualification: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      match: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      tournamentGroup: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      tournamentGroupTeam: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      matchResult: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      tournamentAuditLog: {
        create: jest.fn(),
      },
    };

    matchAccessService = new MatchAccessService(mockPrisma as any, undefined);
  });

  // =========================================================================
  // Test 1: Substitute & Manager get NOT_PLAYING_MEMBER; Playing member gets
  //         credentials after release, and ROOM_NOT_AVAILABLE (425) before.
  // =========================================================================
  describe('1. Member Role Access & Release Timing', () => {
    const tournamentId = 'tourn-1';
    const matchKey = 'm_match-101';
    const teamId = 'team-alpha';

    const mockTeam = {
      id: teamId,
      name: 'Alpha Squad',
      ownerRole: OwnerRole.MANAGER,
      members: [
        { userId: 'u-manager', role: TeamMemberRole.MANAGER },
        { userId: 'u-sub', role: TeamMemberRole.SUBSTITUTE },
        { userId: 'u-player-1', role: TeamMemberRole.PLAYER },
        { userId: 'u-player-2', role: TeamMemberRole.PLAYER },
      ],
    };

    const mockTournament = {
      id: tournamentId,
      title: 'Free Fire Cup',
      startsAt: new Date(Date.now() + 30 * 60 * 1000), // starts in 30 mins
      roomId: 'GLOBAL_ROOM',
      roomPassword: 'GLOBAL_PASS',
      roomReleasedAt: null, // releases at startsAt - 15m
      matches: [
        {
          id: 'match-101',
          tournamentId,
          matchNumber: 1,
          round: 'Round 1',
          groupName: 'Group A',
          map: 'Bermuda',
          status: MatchStatus.SCHEDULED,
          scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
          roomId: 'MATCH_ROOM_1',
          roomPassword: 'SECRET_PASS_1',
          roomReleasedAt: new Date(Date.now() + 15 * 60 * 1000), // in future
          groupId: null,
          results: [],
        },
      ],
      rounds: [],
    };

    beforeEach(() => {
      mockPrisma.tournament.findUnique.mockResolvedValue(mockTournament);
      mockPrisma.roundQualification.findMany.mockResolvedValue([]);
    });

    it('rejects a Manager with 403 NOT_PLAYING_MEMBER', async () => {
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-alpha',
        tournamentId,
        teamId,
        status: RegistrationStatus.CONFIRMED,
        team: mockTeam,
      });

      await expect(
        matchAccessService.assertCanSeeCredentials('u-manager', matchKey, tournamentId),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'NOT_PLAYING_MEMBER' },
      });
    });

    it('rejects a Substitute with 403 NOT_PLAYING_MEMBER', async () => {
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-alpha',
        tournamentId,
        teamId,
        status: RegistrationStatus.CONFIRMED,
        team: mockTeam,
      });

      await expect(
        matchAccessService.assertCanSeeCredentials('u-sub', matchKey, tournamentId),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'NOT_PLAYING_MEMBER' },
      });
    });

    it('returns 425 ROOM_NOT_AVAILABLE (with reveal_at) for playing member before release', async () => {
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-alpha',
        tournamentId,
        teamId,
        status: RegistrationStatus.CONFIRMED,
        team: mockTeam,
      });

      try {
        await matchAccessService.assertCanSeeCredentials('u-player-1', matchKey, tournamentId);
        fail('Should have thrown 425');
      } catch (err: any) {
        expect(err.getStatus()).toBe(425);
        const resp = err.getResponse();
        expect(resp.code).toBe('ROOM_NOT_AVAILABLE');
        expect(resp.reveal_at).toBeDefined();
      }
    });

    it('returns credentials after release time for playing member', async () => {
      // Set release time in past
      const releasedTournament = {
        ...mockTournament,
        matches: [
          {
            ...mockTournament.matches[0],
            roomReleasedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
          },
        ],
      };
      mockPrisma.tournament.findUnique.mockResolvedValue(releasedTournament);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-alpha',
        tournamentId,
        teamId,
        status: RegistrationStatus.CONFIRMED,
        team: mockTeam,
      });

      const creds = await matchAccessService.assertCanSeeCredentials(
        'u-player-1',
        matchKey,
        tournamentId,
      );

      expect(creds.room_id).toBe('MATCH_ROOM_1');
      expect(creds.room_password).toBe('SECRET_PASS_1');
      expect(creds.visible_from).toBeDefined();
      expect(creds.scheduled_at).toBeDefined();
    });
  });

  // =========================================================================
  // Test 2: Eliminated team gets ELIMINATED for later rooms but sees past matches
  // =========================================================================
  describe('2. Elimination Isolation & History Preservation', () => {
    const tournamentId = 'tourn-elim';
    const teamId = 'team-eliminated';

    const mockTeam = {
      id: teamId,
      name: 'Eliminated Team',
      ownerRole: OwnerRole.LEADER,
      members: [
        { userId: 'u-captain', role: TeamMemberRole.CAPTAIN },
        { userId: 'u-p2', role: TeamMemberRole.PLAYER },
      ],
    };

    const mockTournament = {
      id: tournamentId,
      title: 'Multi-Stage Cup',
      status: TournamentStatus.LIVE,
      startsAt: new Date(Date.now() - 2 * 3600 * 1000),
      matches: [
        // Round 1 (past match, completed)
        {
          id: 'match-r1',
          tournamentId,
          matchNumber: 1,
          round: 'Round 1',
          groupName: 'Group 1',
          map: 'Bermuda',
          status: MatchStatus.COMPLETED,
          scheduledAt: new Date(Date.now() - 2 * 3600 * 1000),
          roomId: 'R1_ROOM',
          roomPassword: 'R1_PASSWORD',
          roomReleasedAt: new Date(Date.now() - 2 * 3600 * 1000),
          groupId: null,
          results: [],
        },
        // Round 2 (future match for team)
        {
          id: 'match-r2',
          tournamentId,
          matchNumber: 2,
          round: 'Round 2',
          groupName: 'Group 1',
          map: 'Purgatory',
          status: MatchStatus.SCHEDULED,
          scheduledAt: new Date(Date.now() + 3600 * 1000),
          roomId: 'R2_ROOM',
          roomPassword: 'R2_PASSWORD',
          roomReleasedAt: new Date(Date.now() - 1000), // released
          groupId: 'grp-r2',
          group: {
            id: 'grp-r2',
            name: 'Group 1',
            groupTeams: [
              { tournamentTeamId: 'other-team-1' },
              { tournamentTeamId: 'other-team-2' },
            ],
            round: {
              id: 'round-2-id',
              roundType: 'ROUND_2',
              roundNumber: 2,
            },
          },
          results: [],
        },
      ],
      rounds: [],
    };

    beforeEach(() => {
      mockPrisma.tournament.findUnique.mockResolvedValue(mockTournament);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-elim',
        tournamentId,
        teamId,
        status: RegistrationStatus.CONFIRMED,
        team: mockTeam,
      });

      // Team eliminated in Round 1
      mockPrisma.roundQualification.findMany.mockResolvedValue([
        {
          id: 'q-elim',
          roundId: 'round-1-id',
          tournamentTeamId: teamId,
          destination: QualificationDestination.ELIMINATED,
          round: { roundType: 'ROUND_1', roundNumber: 1 },
        },
      ]);
    });

    it('rejects access to Round 2 room credentials with 403 ELIMINATED', async () => {
      await expect(
        matchAccessService.assertCanSeeCredentials('u-captain', 'm_match-r2', tournamentId),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'ELIMINATED' },
      });
    });

    it('still returns past matches and results in match-center', async () => {
      mockPrisma.matchResult.findMany.mockResolvedValue([
        {
          id: 'res-r1',
          matchId: 'match-r1',
          registrationId: 'reg-elim',
          placement: 8,
          kills: 2,
          placementPoints: 3,
          killPoints: 2,
          totalPoints: 5,
        },
      ]);
      mockPrisma.tournamentGroupTeam.findMany.mockResolvedValue([]);

      const center = await matchAccessService.getMatchCenter(tournamentId, 'u-captain');

      expect(center.my_status.state).toBe('ELIMINATED');
      expect(center.my_status.eliminated_in_round).toBe('Round 1 - Qualifiers');
      expect(center.my_status.total_kills).toBe(2);
      expect(center.my_status.total_points).toBe(5);

      // Verify Round 1 match is visible with past result
      const round1 = center.rounds.find((r) => r.key === 'round_1');
      expect(round1).toBeDefined();
      expect(round1?.matches[0].my_result).toEqual({
        placement: 8,
        kills: 2,
        total_points: 5,
      });

      // Verify Round 2 match is NOT_ELIGIBLE
      const round2 = center.rounds.find((r) => r.key === 'round_2');
      expect(round2).toBeDefined();
      expect(round2?.matches[0].room_state).toBe('NOT_ELIGIBLE');
    });
  });

  // =========================================================================
  // Test 3: Users of another group get NOT_IN_THIS_MATCH
  // =========================================================================
  describe('3. Group Assignment Isolation', () => {
    const tournamentId = 'tourn-groups';
    const matchKey = 'm_match-grp-b';

    const mockTournament = {
      id: tournamentId,
      title: 'Group Stage Championship',
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
      matches: [
        {
          id: 'match-grp-b',
          tournamentId,
          matchNumber: 2,
          round: 'Round 1',
          groupName: 'Group B',
          map: 'Bermuda',
          status: MatchStatus.SCHEDULED,
          scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
          roomId: 'ROOM_B',
          roomPassword: 'PASS_B',
          roomReleasedAt: new Date(Date.now() - 1000), // released
          groupId: 'grp-b',
          group: {
            id: 'grp-b',
            name: 'Group B',
            groupTeams: [{ tournamentTeamId: 'team-beta' }],
            round: { roundType: 'ROUND_1', roundNumber: 1 },
          },
          results: [],
        },
      ],
      rounds: [],
    };

    beforeEach(() => {
      mockPrisma.tournament.findUnique.mockResolvedValue(mockTournament);
      mockPrisma.roundQualification.findMany.mockResolvedValue([]);
    });

    it('rejects users assigned to Group A trying to view Group B room with 403 NOT_IN_THIS_MATCH', async () => {
      // User is in team-alpha (not in Group B)
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-alpha',
        tournamentId,
        teamId: 'team-alpha',
        status: RegistrationStatus.CONFIRMED,
        team: {
          id: 'team-alpha',
          name: 'Team Alpha',
          ownerRole: OwnerRole.LEADER,
          members: [{ userId: 'u-alpha-player', role: TeamMemberRole.PLAYER }],
        },
      });

      await expect(
        matchAccessService.assertCanSeeCredentials('u-alpha-player', matchKey, tournamentId),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'NOT_IN_THIS_MATCH' },
      });
    });
  });

  // =========================================================================
  // Test 4: Public matches endpoints NEVER contain credentials
  // =========================================================================
  describe('4. Credential Leaks Prevention', () => {
    it('asserts toMatchResponse NEVER includes room_id, room_password, roomId, roomPassword keys', () => {
      const matchWithCredentials = {
        id: 'match-secret-1',
        tournamentId: 't-1',
        matchNumber: 1,
        map: 'Bermuda',
        status: MatchStatus.SCHEDULED,
        scheduledAt: new Date(),
        roomId: 'LEAKED_ROOM_ID',
        roomPassword: 'LEAKED_ROOM_PASS',
        roomReleasedAt: new Date(Date.now() - 1000), // released
        tournament: {
          roomId: 'GLOBAL_ROOM',
          roomPassword: 'GLOBAL_PASS',
          roomReleasedAt: new Date(Date.now() - 1000),
        },
        results: [],
        createdAt: new Date(),
      };

      const response = toMatchResponse(matchWithCredentials as any);

      // Verify that no credential keys exist on the response object
      expect(response).not.toHaveProperty('room_id');
      expect(response).not.toHaveProperty('room_password');
      expect(response).not.toHaveProperty('roomId');
      expect(response).not.toHaveProperty('roomPassword');
      expect(response).not.toHaveProperty('password');

      // Verify JSON serialization doesn't leak them
      const jsonString = JSON.stringify(response);
      expect(jsonString).not.toContain('LEAKED_ROOM_ID');
      expect(jsonString).not.toContain('LEAKED_ROOM_PASS');
      expect(jsonString).not.toContain('GLOBAL_ROOM');
      expect(jsonString).not.toContain('GLOBAL_PASS');
      expect(jsonString).not.toContain('"room_id"');
      expect(jsonString).not.toContain('"room_password"');
    });
  });

  // =========================================================================
  // Test 5: Non-registered users get NOT_REGISTERED from match-center
  // =========================================================================
  describe('5. Unregistered User Access Control', () => {
    it('returns 403 NOT_REGISTERED from match-center for an unauthenticated / non-registered user', async () => {
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);

      await expect(
        matchAccessService.getMatchCenter('tourn-1', 'unregistered-user'),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'NOT_REGISTERED' },
      });
    });

    it('returns 403 NOT_REGISTERED from room credentials for an unconfirmed waitlist user', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tourn-1',
        matches: [{ id: 'm1', status: MatchStatus.SCHEDULED, scheduledAt: new Date() }],
        rounds: [],
      });
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-waitlist',
        status: RegistrationStatus.WAITLIST,
      });

      await expect(
        matchAccessService.assertCanSeeCredentials('user-wl', 'm_m1', 'tourn-1'),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'NOT_REGISTERED' },
      });
    });
  });

  describe('5b. Single-lobby match-center room key', () => {
    it('accepts the t_<tournamentId> key emitted when no match unit exists', async () => {
      const tournamentId = 'tourn-single-lobby';
      const startsAt = new Date(Date.now() + 60 * 60 * 1000);
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        map: 'Bermuda',
        status: TournamentStatus.LIVE,
        startsAt,
        roomId: 'TOURNAMENT_ROOM',
        roomPassword: 'TOURNAMENT_PASSWORD',
        roomReleasedAt: new Date(Date.now() - 60 * 1000),
      });
      jest.spyOn(matchAccessService, 'listMatchUnits').mockResolvedValue([]);
      jest.spyOn(matchAccessService, 'getMyAccess').mockResolvedValue({
        registration: { id: 'reg-single', status: RegistrationStatus.CONFIRMED },
        team: null,
        role: 'PLAYER',
        access: 'PLAYING',
        isEliminated: false,
        isDisqualified: false,
      } as any);

      await expect(
        matchAccessService.assertCanSeeCredentials(
          'user-single',
          `t_${tournamentId}`,
          tournamentId,
        ),
      ).resolves.toMatchObject({
        room_id: 'TOURNAMENT_ROOM',
        room_password: 'TOURNAMENT_PASSWORD',
        scheduled_at: startsAt,
      });
    });
  });

  // =========================================================================
  // Test 6: SOLO, DUO, and SQUAD playing set resolution
  // =========================================================================
  describe('6. Playing Set Resolution Across Formats', () => {
    it('correctly resolves SQUAD: Leader plays; Manager does not; Substitute does not', async () => {
      const leaderTeam = {
        id: 'team-leader',
        ownerRole: OwnerRole.LEADER,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
          { userId: 'u-sub', role: TeamMemberRole.SUBSTITUTE },
        ],
      };

      const playingLeaderIds = matchAccessService.filterPlayingMemberIds(leaderTeam as any);
      expect(playingLeaderIds).toEqual(['u-cap', 'u-p1', 'u-p2', 'u-p3']);
      expect(playingLeaderIds).not.toContain('u-sub');

      const managerTeam = {
        id: 'team-manager',
        ownerRole: OwnerRole.MANAGER,
        members: [
          { userId: 'u-mgr', role: TeamMemberRole.MANAGER },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
          { userId: 'u-p4', role: TeamMemberRole.PLAYER },
          { userId: 'u-sub', role: TeamMemberRole.SUBSTITUTE },
        ],
      };

      const playingManagerIds = matchAccessService.filterPlayingMemberIds(managerTeam as any);
      expect(playingManagerIds).toEqual(['u-p1', 'u-p2', 'u-p3', 'u-p4']);
      expect(playingManagerIds).not.toContain('u-mgr');
      expect(playingManagerIds).not.toContain('u-sub');
    });

    it('correctly resolves DUO: both main players play', async () => {
      const duoTeam = {
        id: 'team-duo',
        ownerRole: OwnerRole.LEADER,
        members: [
          { userId: 'u-d1', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-d2', role: TeamMemberRole.PLAYER },
          { userId: 'u-sub', role: TeamMemberRole.SUBSTITUTE },
        ],
      };

      const playingIds = matchAccessService.filterPlayingMemberIds(duoTeam as any);
      expect(playingIds).toEqual(['u-d1', 'u-d2']);
      expect(playingIds).not.toContain('u-sub');
    });

    it('correctly resolves SOLO: the registrant gets access PLAYING', async () => {
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-solo',
        tournamentId: 't-solo',
        userId: 'u-solo',
        teamId: null,
        status: RegistrationStatus.CONFIRMED,
        team: null,
      });

      const access = await matchAccessService.getMyAccess('u-solo', 't-solo');
      expect(access.access).toBe('PLAYING');
      expect(access.role).toBe('PLAYER');
    });
  });

  // =========================================================================
  // Test 7: Credential resolution order (match -> group -> tournament)
  // =========================================================================
  describe('7. Credential Resolution Hierarchy', () => {
    const tournamentBase = {
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
      roomId: 'TOURNAMENT_ROOM',
      roomPassword: 'TOURNAMENT_PASSWORD',
      roomReleasedAt: new Date(Date.now() - 1000), // released
    };

    it('prioritizes match-level credentials when match has credentials', () => {
      const unit: MatchUnit = {
        matchKey: 'm_1',
        tournamentId: 't_1',
        groupName: 'Group 1',
        roundKey: 'round_1',
        roundName: 'Round 1',
        matchNumber: 1,
        map: 'Bermuda',
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        matchRoomId: 'MATCH_ROOM',
        matchRoomPassword: 'MATCH_PASSWORD',
        matchRoomReleasedAt: new Date(Date.now() - 1000), // released
        groupRoomId: 'GROUP_ROOM',
        groupRoomPassword: 'GROUP_PASSWORD',
        groupReleasedAt: new Date(Date.now() - 1000),
        participatingTeamIds: null,
        participatingRegIds: [],
        results: [],
      };

      const creds = matchAccessService.resolveCredentials(unit, tournamentBase);
      expect(creds.source).toBe('match');
      expect(creds.roomId).toBe('MATCH_ROOM');
      expect(creds.roomPassword).toBe('MATCH_PASSWORD');
    });

    it('falls back to group-level credentials when match has no credentials', () => {
      const unit: MatchUnit = {
        matchKey: 'm_2',
        tournamentId: 't_1',
        groupName: 'Group 1',
        roundKey: 'round_1',
        roundName: 'Round 1',
        matchNumber: 1,
        map: 'Bermuda',
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        matchRoomId: null,
        matchRoomPassword: null,
        matchRoomReleasedAt: null,
        groupRoomId: 'GROUP_ROOM',
        groupRoomPassword: 'GROUP_PASSWORD',
        groupReleasedAt: new Date(Date.now() - 1000), // released
        participatingTeamIds: null,
        participatingRegIds: [],
        results: [],
      };

      const creds = matchAccessService.resolveCredentials(unit, tournamentBase);
      expect(creds.source).toBe('group');
      expect(creds.roomId).toBe('GROUP_ROOM');
      expect(creds.roomPassword).toBe('GROUP_PASSWORD');
    });

    it('falls back to tournament-level credentials when match and group have none', () => {
      const unit: MatchUnit = {
        matchKey: 'm_3',
        tournamentId: 't_1',
        groupName: 'Group 1',
        roundKey: 'round_1',
        roundName: 'Round 1',
        matchNumber: 1,
        map: 'Bermuda',
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        matchRoomId: null,
        matchRoomPassword: null,
        matchRoomReleasedAt: null,
        groupRoomId: null,
        groupRoomPassword: null,
        groupReleasedAt: null,
        participatingTeamIds: null,
        participatingRegIds: [],
        results: [],
      };

      const creds = matchAccessService.resolveCredentials(unit, tournamentBase);
      expect(creds.source).toBe('tournament');
      expect(creds.roomId).toBe('TOURNAMENT_ROOM');
      expect(creds.roomPassword).toBe('TOURNAMENT_PASSWORD');
    });
  });
});
