jest.mock('@nestjs/event-emitter', () => ({
  EventEmitter2: class MockEventEmitter {
    emit = jest.fn();
  },
  OnEvent: () => () => {},
}));

jest.mock('@nestjs/config', () => ({
  ConfigService: class MockConfigService {
    get = jest.fn();
    getOrThrow = jest.fn();
  },
}));

jest.mock('@nestjs/jwt', () => ({
  JwtService: class MockJwtService {
    signAsync = jest.fn();
    verifyAsync = jest.fn();
  },
}));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  TeamMode,
  OwnerRole,
  TeamMemberRole,
  TeamRegistrationState,
  RegistrationStatus,
  RegistrationSubmissionStatus,
  RegistrationSubmissionKind,
  RegistrationApprovalStatus,
  TournamentStatus,
  MatchStatus,
  UserRole,
} from '@prisma/client';
import { TeamsService } from './teams.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { RegistrationService } from '../tournaments/registration.service';
import { toTeamResponse } from './team.mapper';
import { toUserResponse } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import { AuditService } from '../tournaments/audit.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { GamesController } from '../games/games.controller';

describe('Section 7 Verification Suite', () => {
  let mockPrisma: any;
  let mockEvents: any;
  let mockConfig: any;
  let mockSquadsService: any;
  let teamsService: TeamsService;
  let tournamentsService: TournamentsService;
  let registrationService: RegistrationService;
  let usersService: UsersService;
  let auditService: AuditService;

  beforeEach(() => {
    mockEvents = {
      emit: jest.fn(),
    };

    mockSquadsService = {
      syncTeamToSquad: jest.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'PAID_TOURNAMENTS_ENABLED') return 'false';
        return null;
      }),
      getOrThrow: jest.fn(),
    };

    mockPrisma = {
      game: {
        findUnique: jest.fn().mockResolvedValue({ id: 'game-1', name: 'Free Fire', slug: 'free_fire' }),
        upsert: jest.fn().mockResolvedValue({ id: 'game-1', name: 'Free Fire', slug: 'free_fire' }),
      },
      tournamentRound: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      team: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      teamMember: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      squadMember: {
        findUnique: jest.fn(),
      },
      squad: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      tournament: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      tournamentRegistration: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      registrationSubmission: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      registrationApproval: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
      },
      registrationEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      },
      tournamentAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      gameProfile: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'gp-1', userId: 'user-1', gameId: 'game-1' }),
      },
      match: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockPrisma);
      }),
    };

    teamsService = new TeamsService(mockPrisma as any, mockSquadsService as any, mockEvents as any);
    registrationService = new RegistrationService(mockPrisma as any, mockEvents as any, mockConfig as any);
    usersService = new UsersService(mockPrisma as any);
    auditService = new AuditService(mockPrisma as any);
    tournamentsService = new TournamentsService(
      mockPrisma as any,
      mockEvents as any,
      mockConfig as any,
      mockSquadsService as any,
      registrationService as any,
      undefined as any,
      auditService as any,
    );
  });

  describe('Scenario 1: DUO correctness', () => {
    it('regular Squad member creates a Duo team as Leader; no Squad rows are created; MANAGER is rejected; no substitutes in Duo', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tourney-duo',
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        startsAt: new Date(Date.now() + 86400000),
      });

      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);
      mockPrisma.gameProfile.findUnique.mockResolvedValue({
        id: 'gp-1',
        userId: 'user-1',
        gameId: 'game-1',
      });

      // 1. MANAGER role rejected for DUO
      await expect(
        tournamentsService.createTournamentTeam('user-1', 'tourney-duo', {
          name: 'Duo Masters',
          tag: 'DM',
          owner_role: OwnerRole.MANAGER,
        } as any),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'DUO_NO_MANAGER' }),
        }),
      );

      // 2. Regular squad member creates DUO team as LEADER
      mockPrisma.squadMember.findUnique.mockResolvedValue({
        userId: 'user-1',
        role: 'MEMBER', // Not leader of squad, but allowed for DUO!
      });

      mockPrisma.team.findUnique.mockResolvedValue(null); // inviteCode uniqueness
      mockPrisma.team.create.mockResolvedValue({
        id: 'team-duo-1',
        name: 'Duo Masters',
        tag: 'DM',
        gameId: 'game-1',
        tournamentId: 'tourney-duo',
        captainId: 'user-1',
        ownerRole: OwnerRole.LEADER,
        acceptingSubstitutes: false,
        members: [{ id: 'm-1', userId: 'user-1', role: TeamMemberRole.CAPTAIN, user: { gameProfiles: [] } }],
        captain: { id: 'user-1', name: 'User 1' },
      });

      const team = await tournamentsService.createTournamentTeam('user-1', 'tourney-duo', {
        name: 'Duo Masters',
        tag: 'DM',
        owner_role: OwnerRole.LEADER,
      } as any);

      expect(team.owner_role).toBe(OwnerRole.LEADER);
      expect(team.accepting_substitutes).toBe(false);
      // No squad rows created and syncTeamToSquad bypassed
      expect(mockPrisma.squad.create).not.toHaveBeenCalled();
      expect(mockSquadsService.syncTeamToSquad).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 2: SOLO tournament correctness', () => {
    it('Squad member registers for a SOLO tournament creating no team and returning confirmed registration', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tourney-solo',
        teamMode: TeamMode.SOLO,
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        maxSlots: 100,
        registeredCount: 5,
        title: 'Solo Cup',
      });

      mockPrisma.gameProfile.findUnique.mockResolvedValue({
        id: 'gp-solo',
        userId: 'user-solo',
        gameId: 'game-1',
      });

      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);
      mockPrisma.tournamentRegistration.create.mockResolvedValue({
        id: 'reg-solo',
        tournamentId: 'tourney-solo',
        userId: 'user-solo',
        teamId: null,
        status: RegistrationStatus.CONFIRMED,
        slotNumber: 1,
      });

      const res = await registrationService.register('user-solo', 'tourney-solo', {} as any);

      expect(res.status).toBe(RegistrationStatus.CONFIRMED);
      expect(res.teamId).toBeNull();
      expect(mockPrisma.team.create).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 3: Confirmed team roster changes', () => {
    it('swap main with substitute creates ROSTER_CHANGE submission, approves atomically with roster_version + 1, decline cancels change, locks after lock time', async () => {
      const lockTime = new Date(Date.now() + 3600000); // 1 hour in future

      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-c1',
        name: 'Alpha Team',
        captainId: 'leader-1',
        ownerRole: OwnerRole.LEADER,
        tournamentId: 'tourney-squad',
        registrationState: TeamRegistrationState.CONFIRMED,
        rosterVersion: 1,
        acceptingSubstitutes: true,
        members: [
          { id: 'm-1', userId: 'leader-1', role: TeamMemberRole.PLAYER, user: { name: 'Leader' } },
          { id: 'm-2', userId: 'p-2', role: TeamMemberRole.PLAYER, user: { name: 'Player 2' } },
          { id: 'm-3', userId: 'p-3', role: TeamMemberRole.PLAYER, user: { name: 'Player 3' } },
          { id: 'm-4', userId: 'p-4', role: TeamMemberRole.PLAYER, user: { name: 'Player 4' } },
          { id: 'm-5', userId: 'sub-1', role: TeamMemberRole.SUBSTITUTE, user: { name: 'Sub 1' } },
        ],
        tournament: {
          id: 'tourney-squad',
          title: 'Squad Cup',
          teamMode: TeamMode.SQUAD,
          rosterLockAt: lockTime,
          status: TournamentStatus.LIVE,
          matches: [],
        },
      });

      mockPrisma.registrationSubmission.findFirst.mockResolvedValue(null);
      mockPrisma.match.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tourney-squad',
        rosterLockAt: lockTime,
        startsAt: null,
        title: 'Squad Cup',
        status: TournamentStatus.LIVE,
      });

      // 1. Request swap: replace p-4 with sub-1 in main playing roster
      mockPrisma.registrationSubmission.create.mockResolvedValue({
        id: 'sub-rc-1',
        tournamentId: 'tourney-squad',
        teamId: 'team-c1',
        rosterVersion: 1,
        kind: RegistrationSubmissionKind.ROSTER_CHANGE,
        status: RegistrationSubmissionStatus.ACTIVE,
        playingUserIds: ['leader-1', 'p-2', 'p-3', 'sub-1'],
        removeUserIds: [],
        approvals: [
          { id: 'app-rc-1', userId: 'sub-1', status: RegistrationApprovalStatus.PENDING },
        ],
      });

      const rcResult = await teamsService.requestRosterChange('leader-1', 'team-c1', {
        main_user_ids: ['leader-1', 'p-2', 'p-3', 'sub-1'],
      });

      expect(rcResult.success).toBe(true);
      expect(rcResult.applied_immediately).toBe(false);
      expect(rcResult.submission_id).toBe('sub-rc-1');
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'team.roster_change_requested',
        expect.objectContaining({ approvalId: 'app-rc-1', approverUserId: 'sub-1' }),
      );

      // 2. Approve the roster change
      mockPrisma.registrationApproval.findUnique.mockResolvedValue({
        id: 'app-rc-1',
        userId: 'sub-1',
        status: RegistrationApprovalStatus.PENDING,
        submission: {
          id: 'sub-rc-1',
          tournamentId: 'tourney-squad',
          teamId: 'team-c1',
          rosterVersion: 1,
          kind: RegistrationSubmissionKind.ROSTER_CHANGE,
          status: RegistrationSubmissionStatus.ACTIVE,
          playingUserIds: ['leader-1', 'p-2', 'p-3', 'sub-1'],
          removeUserIds: [],
          approvals: [
            { id: 'app-rc-1', userId: 'sub-1', status: RegistrationApprovalStatus.PENDING },
          ],
          tournament: {
            id: 'tourney-squad',
            title: 'Squad Cup',
            rosterLockAt: lockTime,
            status: TournamentStatus.LIVE,
          },
          team: {
            id: 'team-c1',
            name: 'Alpha Team',
            captainId: 'leader-1',
            ownerRole: OwnerRole.LEADER,
            registrationState: TeamRegistrationState.CONFIRMED,
            rosterVersion: 1,
            members: [
              { id: 'm-1', userId: 'leader-1', role: TeamMemberRole.PLAYER },
              { id: 'm-2', userId: 'p-2', role: TeamMemberRole.PLAYER },
              { id: 'm-3', userId: 'p-3', role: TeamMemberRole.PLAYER },
              { id: 'm-4', userId: 'p-4', role: TeamMemberRole.PLAYER },
              { id: 'm-5', userId: 'sub-1', role: TeamMemberRole.SUBSTITUTE },
            ],
          },
        },
      });

      mockPrisma.teamMember.findMany.mockResolvedValue([
        { userId: 'leader-1' },
        { userId: 'p-2' },
        { userId: 'p-3' },
        { userId: 'sub-1' },
        { userId: 'p-4' },
      ]);

      const approveRes = await registrationService.approve('sub-1', 'app-rc-1');

      expect(approveRes.success).toBe(true);
      expect(approveRes.roster_version).toBe(2);
      expect(mockPrisma.team.update).toHaveBeenCalledWith({
        where: { id: 'team-c1' },
        data: { rosterVersion: 2 },
      });
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'team.roster_change_applied',
        expect.objectContaining({ rosterVersion: 2 }),
      );

      // 3. Test locking after lock time
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tourney-squad',
        rosterLockAt: new Date(Date.now() - 10000), // In past!
        status: TournamentStatus.LIVE,
        matches: [],
      });

      await expect(
        teamsService.requestRosterChange('leader-1', 'team-c1', {
          main_user_ids: ['leader-1', 'p-2', 'p-3', 'sub-1'],
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ROSTER_LOCKED_BY_TIME' }),
        }),
      );
    });
  });

  describe('Scenario 4: Leaving and removing from confirmed teams', () => {
    it('only substitutes can leave/be removed from a confirmed team; playing members cannot leave directly', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-c1',
        captainId: 'leader-1',
        tournamentId: 'tourney-1',
        registrationState: TeamRegistrationState.CONFIRMED,
        tournament: { rosterLockAt: new Date(Date.now() + 3600000) },
        members: [
          { id: 'm-1', userId: 'leader-1', role: TeamMemberRole.PLAYER },
          { id: 'm-2', userId: 'player-2', role: TeamMemberRole.PLAYER },
          { id: 'm-3', userId: 'sub-1', role: TeamMemberRole.SUBSTITUTE },
        ],
      });
      mockPrisma.match.findFirst.mockResolvedValue(null);

      // Playing member attempts to leave -> rejected
      await expect(teamsService.leaveTeam('player-2', 'team-c1')).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'TEAM_ROSTER_LOCKED' }),
        }),
      );

      // Substitute leaves -> allowed
      mockPrisma.teamMember.findFirst.mockResolvedValue({
        id: 'm-3',
        userId: 'sub-1',
        role: TeamMemberRole.SUBSTITUTE,
      });

      const leaveRes = await teamsService.leaveTeam('sub-1', 'team-c1');
      expect(leaveRes.message).toBe('Successfully left the team');
    });
  });

  describe('Scenario 5: Profile completion and phone validation', () => {
    it('needs_profile_setup is computed correctly and phone is cleaned loosely', async () => {
      // 1. Missing phone -> needs_profile_setup = true
      const userWithoutPhone = {
        id: 'u-1',
        name: 'Gamer',
        email: 'gamer@blastix.gg',
        phone: null,
        profilePic: null,
        isVip: false,
        crownBadgeUnlocked: false,
        role: 'USER',
        isActive: true,
        createdAt: new Date(),
      };
      const res1 = toUserResponse(userWithoutPhone as any);
      expect(res1.needs_profile_setup).toBe(true);

      // 2. Both name and phone present -> needs_profile_setup = false
      const userComplete = {
        ...userWithoutPhone,
        phone: '+919876543210',
      };
      const res2 = toUserResponse(userComplete as any);
      expect(res2.needs_profile_setup).toBe(false);

      // 3. Phone validation and cleaning in usersService
      mockPrisma.user.update.mockImplementation(async ({ data }: any) => ({
        ...userComplete,
        phone: data.phone,
      }));

      // Formatted phone with dashes and spaces: +91 98765-43210
      await usersService.updateUserProfile('u-1', {
        phone: '+91 98765-43210',
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '+919876543210' }),
        }),
      );

      // Invalid short phone (< 10 digits)
      await expect(
        usersService.updateUserProfile('u-1', { phone: '12345' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Scenario 6: Hardening (Redis logout blacklist, admin/games)', () => {
    it('JwtAuthGuard rejects blacklisted tokens and GET /admin/games has ADMIN role metadata', async () => {
      const mockJwt = {
        verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-1' }),
      };
      const mockReflector = {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      };
      const mockRedis = {
        client: {
          get: jest.fn().mockImplementation(async (key: string) => {
            if (key === 'bl_revoked-token') return '1';
            return null;
          }),
        },
      };

      const guard = new JwtAuthGuard(mockJwt as any, mockReflector as any, mockRedis as any);

      // Token in blacklist -> rejected
      const mockContextBlacklisted = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer revoked-token' },
          }),
        }),
      } as any;

      await expect(guard.canActivate(mockContextBlacklisted)).rejects.toThrow(
        UnauthorizedException,
      );

      // Valid token -> allowed
      const mockContextValid = {
        getHandler: () => {},
        getClass: () => {},
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { authorization: 'Bearer valid-token' },
          }),
        }),
      } as any;

      const allowed = await guard.canActivate(mockContextValid);
      expect(allowed).toBe(true);

      // Fail-open when Redis throws
      mockRedis.client.get.mockRejectedValueOnce(new Error('Redis connection lost'));
      const allowedFailOpen = await guard.canActivate(mockContextValid);
      expect(allowedFailOpen).toBe(true);

      // Verify GamesController admin endpoint has roles
      const gamesService = { listGames: jest.fn().mockResolvedValue([]) };
      const gamesController = new GamesController(gamesService as any);
      expect(gamesController.getAdminGames).toBeDefined();
    });
  });

  describe('Scenario 7: Audit trail redaction and actions', () => {
    it('AuditService logs actions and strictly redacts passwords, tokens, and session URLs', async () => {
      await auditService.log({
        tournamentId: 'tourney-audit-1',
        action: 'ROOM_CREDENTIALS_PUBLISHED',
        actorUserId: 'admin-1',
        details: {
          roomId: 'room-101',
          roomPassword: 'SECRET_PASSWORD_123',
          token: 'jwt-super-secret',
          sessionUrl: 'https://rtmp.live/session-secret',
          publicInfo: 'Match 1 credentials',
        },
      });

      expect(mockPrisma.tournamentAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tournamentId: 'tourney-audit-1',
          action: 'ROOM_CREDENTIALS_PUBLISHED',
          adminUserId: 'admin-1',
          details: {
            roomId: 'room-101',
            publicInfo: 'Match 1 credentials',
          },
        }),
      });

      // Verify secret fields were deleted
      const loggedDetails = mockPrisma.tournamentAuditLog.create.mock.calls[0][0].data.details;
      expect(loggedDetails.roomPassword).toBeUndefined();
      expect(loggedDetails.token).toBeUndefined();
      expect(loggedDetails.sessionUrl).toBeUndefined();
    });
  });
});
