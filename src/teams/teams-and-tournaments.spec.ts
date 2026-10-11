jest.mock('@nestjs/event-emitter', () => ({
  EventEmitter2: class MockEventEmitter {
    emit = jest.fn();
  },
}));

jest.mock('@nestjs/config', () => ({
  ConfigService: class MockConfigService {
    get = jest.fn();
  },
}));

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { SquadsService } from '../squads/squads.service';
import { TeamMemberRole, RegistrationStatus, TournamentStatus, TeamMode, SquadRole, TeamRegistrationState, TeamJoinRequestStatus } from '@prisma/client';

describe('Teams & Tournaments Features', () => {
  let teamsService: TeamsService;
  let tournamentsService: TournamentsService;
  let mockPrisma: any;
  let mockEventEmitter: any;
  let mockConfig: any;
  let mockSquadsService: any;

  beforeEach(() => {
    mockPrisma = {
      game: { findUnique: jest.fn() },
      gameProfile: { findUnique: jest.fn(), findMany: jest.fn() },
      team: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      squad: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      squadMember: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
      },
      tournamentInvitation: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      teamMember: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tournament: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      tournamentRegistration: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { slotNumber: 1 } }),
        create: jest.fn(),
        update: jest.fn(),
      },
      tournamentWaitlist: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      teamJoinRequest: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(async (cbOrArr, options) => {
        if (typeof cbOrArr === 'function') {
          return cbOrArr(mockPrisma);
        }
        return Promise.all(cbOrArr);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };

    mockEventEmitter = { emit: jest.fn() };
    mockConfig = { get: jest.fn() };
    mockSquadsService = {
      syncTeamToSquad: jest.fn().mockResolvedValue(undefined),
    };

    teamsService = new TeamsService(mockPrisma, mockSquadsService as any, mockEventEmitter);
    tournamentsService = new TournamentsService(mockPrisma, mockEventEmitter, mockConfig);
  });

  describe('Teams: Substitutes toggle & Join roles', () => {
    it('captain can toggle acceptingSubstitutes', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        acceptingSubstitutes: true,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.team.update.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        acceptingSubstitutes: false,
      });

      const res = await teamsService.toggleSubstitutes('user-cap', 'team-1', false);
      expect(mockPrisma.team.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: { acceptingSubstitutes: false },
      });
    });

    it('non-captain cannot toggle substitutes', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        members: [],
      });

      await expect(teamsService.toggleSubstitutes('other-user', 'team-1', false)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects joining as substitute when team is not accepting substitutes', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        acceptingSubstitutes: false,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.gameProfile.findUnique.mockResolvedValue({ id: 'gp-1' });

      await expect(
        teamsService.joinTeam('user-2', { as_substitute: true }, 'team-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows joining as substitute when team accepts substitutes', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        inviteCode: 'CODE1234',
        acceptingSubstitutes: true,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.gameProfile.findUnique.mockResolvedValue({ id: 'gp-1' });
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);
      mockPrisma.teamMember.create.mockResolvedValue({});

      await teamsService.joinTeam('user-2', { as_substitute: true }, 'team-1');

      expect(mockPrisma.teamMember.create).toHaveBeenCalledWith({
        data: {
          teamId: 'team-1',
          userId: 'user-2',
          role: TeamMemberRole.SUBSTITUTE,
        },
      });
    });

    it('blocks roster changes after the team has a confirmed registration', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        inviteCode: 'CODE1234',
        acceptingSubstitutes: true,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({ id: 'registration-1' });

      await expect(
        teamsService.joinTeam('user-2', { invite_code: 'CODE1234' }, 'team-1'),
      ).rejects.toMatchObject({
        response: { code: 'TEAM_ROSTER_LOCKED' },
      });
      expect(mockPrisma.gameProfile.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('Teams: Leave & Transfer Captain', () => {
    it('captain cannot leave without transferring captaincy', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        members: [{ userId: 'user-cap' }],
      });

      await expect(teamsService.leaveTeam('user-cap', 'team-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('regular member can leave team', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        members: [{ userId: 'user-cap' }, { userId: 'user-player' }],
      });
      mockPrisma.teamMember.delete.mockResolvedValue({});

      const res = await teamsService.leaveTeam('user-player', 'team-1');
      expect(res.message).toBe('Successfully left the team');
      expect(mockPrisma.teamMember.delete).toHaveBeenCalled();
    });

    it('captain can transfer captaincy to another member', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-next', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.teamMember.update.mockResolvedValue({});
      mockPrisma.team.update.mockResolvedValue({});

      await teamsService.transferCaptaincy('user-cap', 'team-1', 'user-next');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('Tournaments: my-team, teams, and code preview', () => {
    it('rejects registration while the tournament is UPCOMING', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        status: TournamentStatus.UPCOMING,
      });

      await expect(
        tournamentsService.registerUserOrTeam('user-1', 'tour-1', {}),
      ).rejects.toThrow('Registration opens only when the tournament is LIVE');
      expect(mockPrisma.team.findUnique).not.toHaveBeenCalled();
    });

    it('keeps paid registration blocked even if the feature flag is enabled without wallet support', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        status: TournamentStatus.LIVE,
        entryFee: 100,
      });
      mockConfig.get.mockReturnValue('true');

      await expect(
        tournamentsService.registerUserOrTeam('user-1', 'tour-1', {}),
      ).rejects.toMatchObject({
        response: { code: 'PAID_TOURNAMENTS_UNAVAILABLE' },
      });
      expect(mockPrisma.team.findUnique).not.toHaveBeenCalled();
    });

    it('returns the specified 403 error when a regular squad member registers a team', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        teamMode: TeamMode.DUO,
        entryFee: 0,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        captainId: 'user-1',
        members: [{ userId: 'user-1', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.squadMember.findUnique.mockResolvedValue({ role: SquadRole.MEMBER });

      await expect(
        tournamentsService.registerUserOrTeam('user-1', 'tour-1', { team_id: 'team-1' }),
      ).rejects.toMatchObject({
        status: 403,
        response: {
          status: 'error',
          error_code: 'NON_LEADER_REGISTRATION_FORBIDDEN',
          message: 'please ask team leader to register the tournament',
        },
      });
    });

    it('rejects SQUAD registration unless the team has exactly four main players', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        teamMode: TeamMode.SQUAD,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        captainId: 'user-cap',
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-p2', role: TeamMemberRole.PLAYER },
          { userId: 'user-p3', role: TeamMemberRole.PLAYER },
        ],
      });

      await expect(
        tournamentsService.registerUserOrTeam('user-cap', 'tour-1', { team_id: 'team-1' }),
      ).rejects.toMatchObject({
        response: {
          code: 'INVALID_MEMBER_COUNT',
        },
      });
    });

    it('allows exactly four main players with a substitute on a SQUAD roster', async () => {
      mockPrisma.tournament.findUnique
        .mockResolvedValueOnce({
          id: 'tour-1',
          gameId: 'game-1',
          status: TournamentStatus.LIVE,
          teamMode: TeamMode.SQUAD,
          entryFee: 0,
          maxSlots: 16,
          registeredCount: 0,
        })
        .mockResolvedValueOnce({ registeredCount: 1 });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        tournamentId: 'tour-1',
        captainId: 'user-cap',
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-p2', role: TeamMemberRole.PLAYER },
          { userId: 'user-p3', role: TeamMemberRole.PLAYER },
          { userId: 'user-p4', role: TeamMemberRole.PLAYER },
          { userId: 'user-sub', role: TeamMemberRole.SUBSTITUTE },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'user-cap' },
        { userId: 'user-p2' },
        { userId: 'user-p3' },
        { userId: 'user-p4' },
      ]);
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournamentRegistration.create.mockResolvedValue({
        id: 'registration-1',
        tournamentId: 'tour-1',
        userId: 'user-cap',
        teamId: 'team-1',
        status: RegistrationStatus.CONFIRMED,
        slotNumber: 1,
        finalRank: null,
        createdAt: new Date(),
      });
      mockPrisma.squad.create.mockResolvedValue({
        id: 'squad-1',
        members: [
          { userId: 'user-cap' },
          { userId: 'user-p2' },
          { userId: 'user-p3' },
          { userId: 'user-p4' },
          { userId: 'user-sub' },
        ],
      });

      const registration = await tournamentsService.registerUserOrTeam(
        'user-cap',
        'tour-1',
        { team_id: 'team-1' },
      );

      expect(registration.teamId).toBe('team-1');
      expect(mockPrisma.gameProfile.findMany).toHaveBeenCalledWith({
        where: {
          gameId: 'game-1',
          userId: { in: ['user-cap', 'user-p2', 'user-p3', 'user-p4'] },
        },
      });
      expect(mockPrisma.squad.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            leaderId: 'user-cap',
            members: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({ userId: 'user-cap', role: 'LEADER', rosterType: 'MAIN' }),
                expect.objectContaining({ userId: 'user-sub', rosterType: 'SUBSTITUTE' }),
              ]),
            }),
          }),
        }),
      );
      expect(mockPrisma.team.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: { persistentSquadId: 'squad-1' },
      });
    });

    it('creates a team during UPCOMING without registering it', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        gameId: 'game-1',
        status: TournamentStatus.UPCOMING,
      });
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.gameProfile.findUnique.mockResolvedValue({ id: 'profile-1' });
      mockPrisma.team.create.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        name: 'Alpha',
        tag: 'ALPH',
        logoUrl: null,
        captainId: 'user-cap',
        inviteCode: 'CODE1234',
        acceptingSubstitutes: true,
        createdAt: new Date(),
        members: [],
      });

      const created = await tournamentsService.createTournamentTeam('user-cap', 'tour-1', {
        name: ' Alpha ',
        tag: 'alph',
      });

      expect(created.is_registered_in_tournament).toBe(false);
      expect(created.slot_number).toBeNull();
      expect(mockPrisma.team.create).toHaveBeenCalled();
      expect(mockPrisma.tournamentRegistration.create).not.toHaveBeenCalled();
      expect(mockPrisma.tournament.update).not.toHaveBeenCalled();
    });

    it('creates a team with an empty tag when no tag is supplied', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        gameId: 'game-1',
        status: TournamentStatus.UPCOMING,
      });
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.gameProfile.findUnique.mockResolvedValue({ id: 'profile-1' });
      mockPrisma.team.create.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        name: 'Alpha',
        tag: '',
        logoUrl: null,
        captainId: 'user-cap',
        inviteCode: 'CODE1234',
        acceptingSubstitutes: true,
        createdAt: new Date(),
        members: [],
      });

      await tournamentsService.createTournamentTeam('user-cap', 'tour-1', {
        name: 'Alpha',
        tag: '',
      });

      expect(mockPrisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tag: '' }),
        }),
      );
    });

    it('creates a Manager-owned team with MANAGER member role', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        gameId: 'game-1',
        status: TournamentStatus.UPCOMING,
      });
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.gameProfile.findUnique.mockResolvedValue({ id: 'profile-1' });
      mockPrisma.team.create.mockResolvedValue({
        id: 'team-mgr',
        gameId: 'game-1',
        name: 'ManagerSquad',
        tag: 'MGR',
        logoUrl: null,
        captainId: 'user-mgr',
        ownerRole: 'MANAGER',
        inviteCode: 'MGR12345',
        acceptingSubstitutes: true,
        createdAt: new Date(),
        members: [{ userId: 'user-mgr', role: 'MANAGER' }],
      });

      const created = await tournamentsService.createTournamentTeam('user-mgr', 'tour-1', {
        name: 'ManagerSquad',
        tag: 'MGR',
        owner_role: 'MANAGER' as any,
      });

      expect(mockPrisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerRole: 'MANAGER',
            members: {
              create: {
                userId: 'user-mgr',
                role: 'MANAGER',
              },
            },
          }),
        }),
      );
      expect(created.owner_role).toBe('MANAGER');
    });

    it('previewTeamByCode returns team preview and slot availability', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        gameId: 'game-1',
        teamMode: TeamMode.SQUAD,
      });
      mockPrisma.team.findFirst.mockResolvedValue({
        id: 'team-1',
        name: 'AlphaSquad',
        tag: 'ALPH',
        inviteCode: 'CODE12',
        acceptingSubstitutes: true,
        captainId: 'user-cap',
        captain: { id: 'user-cap', name: 'Captain' },
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-p2', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.tournamentRegistration.findUnique.mockResolvedValue(null);

      const preview = await tournamentsService.previewTeamByCode('tour-1', 'CODE12', 'user-visitor');

      expect(preview.name).toBe('AlphaSquad');
      expect(preview.main_count).toBe(2);
      expect(preview.max_main).toBe(4);
      expect(preview.slots_available).toBe(3);
      expect(preview.responsible_person.name).toBe('Captain');
      expect(preview.members[0]).not.toHaveProperty('email');
      expect(preview.members[0]).not.toHaveProperty('phone');
      expect(preview.members[0]).not.toHaveProperty('in_game_uid');
      expect(preview.members[0]).not.toHaveProperty('in_game_name');
    });

    it('getMyTeamForTournament returns null when user has no team in tournament', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({ id: 'tour-1' });
      mockPrisma.teamMember.findMany.mockResolvedValue([]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);

      const res = await tournamentsService.getMyTeamForTournament('user-1', 'tour-1');
      expect(res).toBeNull();
    });

    it('getMyTeamForTournament returns an unregistered tournament lobby team', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({ id: 'tour-1' });
      mockPrisma.team.findFirst.mockResolvedValue({
        id: 'team-1',
        gameId: 'game-1',
        tournamentId: 'tour-1',
        name: 'Alpha',
        tag: 'ALPH',
        logoUrl: null,
        captainId: 'user-1',
        inviteCode: 'CODE1234',
        acceptingSubstitutes: true,
        createdAt: new Date(),
        captain: { id: 'user-1', name: 'Captain' },
        members: [],
      });
      mockPrisma.tournamentRegistration.findUnique.mockResolvedValue(null);

      const res = await tournamentsService.getMyTeamForTournament('user-1', 'tour-1');

      expect(res).toMatchObject({
        id: 'team-1',
        tournament_id: 'tour-1',
        is_registered: false,
        slot_number: null,
        registration_status: 'FORMING',
      });
    });

    it('registered-teams response counts only main players', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({ id: 'tour-1' });
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-10-03T18:00:00.000Z'),
          team: {
            id: 'team-1',
            name: 'Alpha',
            tag: 'ALPH',
            logoUrl: null,
            captain: { name: 'Captain' },
            members: [
              { role: TeamMemberRole.CAPTAIN },
              { role: TeamMemberRole.PLAYER },
              { role: TeamMemberRole.PLAYER },
              { role: TeamMemberRole.PLAYER },
              { role: TeamMemberRole.SUBSTITUTE },
            ],
          },
        },
      ]);

      const teams = await tournamentsService.getRegisteredTeamsForTournament('tour-1');

      expect(teams).toEqual([
        {
          id: 'team-1',
          name: 'Alpha',
          tag: 'ALPH',
          logo_url: '',
          captain_name: 'Captain',
          member_count: 4,
          registered_at: new Date('2026-10-03T18:00:00.000Z'),
        },
      ]);
    });
  });

  describe('Section 1 Tournament Registration Redesign', () => {
    let squadsService: SquadsService;

    beforeEach(() => {
      squadsService = new SquadsService(mockPrisma, mockEventEmitter);
    });

    it('1. register happy path sets state CONFIRMED and returns the slot number and emits slot_confirmed', async () => {
      mockPrisma.tournament.findUnique
        .mockResolvedValueOnce({
          id: 'tour-1',
          title: 'BlastX Championship',
          gameId: 'game-1',
          status: TournamentStatus.LIVE,
          teamMode: TeamMode.SQUAD,
          entryFee: 0,
          maxSlots: 16,
          registeredCount: 0,
        })
        .mockResolvedValueOnce({ registeredCount: 1 });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team Alpha',
        gameId: 'game-1',
        tournamentId: 'tour-1',
        captainId: 'user-cap',
        captain: { name: 'Captain' },
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-p2', role: TeamMemberRole.PLAYER },
          { userId: 'user-p3', role: TeamMemberRole.PLAYER },
          { userId: 'user-p4', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'user-cap' },
        { userId: 'user-p2' },
        { userId: 'user-p3' },
        { userId: 'user-p4' },
      ]);
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournamentRegistration.create.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 'tour-1',
        userId: 'user-cap',
        teamId: 'team-1',
        status: RegistrationStatus.CONFIRMED,
        slotNumber: 1,
        createdAt: new Date(),
      });
      mockPrisma.team.update.mockResolvedValue({ id: 'team-1', registrationState: TeamRegistrationState.CONFIRMED });

      const reg = await tournamentsService.registerUserOrTeam('user-cap', 'tour-1', { team_id: 'team-1' });

      expect(reg.slotNumber).toBe(1);
      expect(reg.status).toBe(RegistrationStatus.CONFIRMED);
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'team-1' },
          data: expect.objectContaining({ registrationState: TeamRegistrationState.CONFIRMED }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.slot_confirmed',
        expect.objectContaining({
          userIds: expect.arrayContaining(['user-cap', 'user-p2', 'user-p3', 'user-p4']),
          tournamentTitle: 'BlastX Championship',
          tournamentId: 'tour-1',
          slotNumber: 1,
        }),
      );
    });

    it('2. calling register twice is idempotent and does not increment registeredCount', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'BlastX Championship',
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        teamMode: TeamMode.SQUAD,
        entryFee: 0,
        maxSlots: 16,
        registeredCount: 5,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team Alpha',
        gameId: 'game-1',
        tournamentId: 'tour-1',
        captainId: 'user-cap',
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-p2', role: TeamMemberRole.PLAYER },
          { userId: 'user-p3', role: TeamMemberRole.PLAYER },
          { userId: 'user-p4', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'user-cap' },
        { userId: 'user-p2' },
        { userId: 'user-p3' },
        { userId: 'user-p4' },
      ]);
      const existingReg = {
        id: 'reg-existing',
        tournamentId: 'tour-1',
        userId: 'user-cap',
        teamId: 'team-1',
        status: RegistrationStatus.CONFIRMED,
        slotNumber: 3,
        createdAt: new Date(),
      };
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([existingReg]);

      const result = await tournamentsService.registerUserOrTeam('user-cap', 'tour-1', { team_id: 'team-1' });

      expect(result.id).toBe('reg-existing');
      expect(result.slotNumber).toBe(3);
      expect(result.status).toBe(RegistrationStatus.CONFIRMED);
      expect(mockPrisma.tournament.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.tournamentRegistration.create).not.toHaveBeenCalled();
    });

    it('3. accepting the 4th invitation does NOT create a registration and does NOT change registeredCount', async () => {
      mockPrisma.tournamentInvitation.findUnique.mockResolvedValue({
        id: 'inv-4',
        inviteeUserId: 'user-p4',
        teamId: 'team-1',
        tournamentId: 'tour-1',
        squadId: 'squad-1',
        status: 'PENDING',
        leaderId: 'user-cap',
        invitee: { name: 'Player 4', isActive: true },
        tournament: { title: 'BlastX Championship', status: TournamentStatus.LIVE },
      });
      mockPrisma.squadMember.findUnique.mockResolvedValue({ userId: 'user-p4', squadId: 'squad-1' });
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);
      mockPrisma.teamMember.create.mockResolvedValue({ id: 'tm-4' });
      mockPrisma.tournamentInvitation.update.mockResolvedValue({ id: 'inv-4', status: 'ACCEPTED' });

      const response = await squadsService.respondToInvitation('user-p4', 'inv-4', 'ACCEPT');

      expect(response.status).toBe('ACCEPTED');
      expect(response.auto_registered).toBe(false);
      expect(mockPrisma.tournamentRegistration.create).not.toHaveBeenCalled();
      expect(mockPrisma.tournament.update).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'squad.invitation.responded',
        expect.objectContaining({ action: 'ACCEPT' }),
      );
    });

    it('4. unregister resets state to FORMING', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        registrationClosesAt: new Date(Date.now() + 1000000),
        entryFee: 0,
      });
      mockPrisma.teamMember.findMany.mockResolvedValue([{ teamId: 'team-1' }]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 'tour-1',
        teamId: 'team-1',
        status: RegistrationStatus.CONFIRMED,
      });
      mockPrisma.tournamentRegistration.update.mockResolvedValue({ id: 'reg-1', status: RegistrationStatus.CANCELLED });
      mockPrisma.tournament.update.mockResolvedValue({ id: 'tour-1' });
      mockPrisma.team.update.mockResolvedValue({ id: 'team-1', registrationState: TeamRegistrationState.FORMING });

      const unreg = await tournamentsService.unregisterUserOrTeam('user-cap', 'tour-1');

      expect(unreg.message).toBe('Successfully unregistered from tournament');
      expect(mockPrisma.tournamentRegistration.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { status: RegistrationStatus.CANCELLED },
      });
      expect(mockPrisma.tournament.update).toHaveBeenCalledWith({
        where: { id: 'tour-1' },
        data: { registeredCount: { decrement: 1 } },
      });
      expect(mockPrisma.team.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: { registrationState: TeamRegistrationState.FORMING },
      });
    });

    it('5. two simultaneous registrations for the last slot never exceed max_slots (atomic failure throws full)', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'BlastX Championship',
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        teamMode: TeamMode.SQUAD,
        entryFee: 0,
        maxSlots: 10,
        registeredCount: 10,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-2',
        name: 'Team Beta',
        gameId: 'game-1',
        tournamentId: 'tour-1',
        captainId: 'user-cap2',
        members: [
          { userId: 'user-cap2', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-b2', role: TeamMemberRole.PLAYER },
          { userId: 'user-b3', role: TeamMemberRole.PLAYER },
          { userId: 'user-b4', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'user-cap2' },
        { userId: 'user-b2' },
        { userId: 'user-b3' },
        { userId: 'user-b4' },
      ]);
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      // Atomic conditional update fails because capacity was taken
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        tournamentsService.registerUserOrTeam('user-cap2', 'tour-1', { team_id: 'team-2' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.tournamentRegistration.create).not.toHaveBeenCalled();
    });
  });

  describe('Section 2: Team Join Requests & Privacy-Safe Preview', () => {
    it('1. a request is created and does not count in roster size', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({
        id: 'team-1',
        name: 'Team Fire',
        tag: 'FIRE',
        gameId: 'game-1',
        inviteCode: 'JOIN12',
        captainId: 'user-cap',
        acceptingSubstitutes: true,
        requireJoinApproval: true,
        registrationState: TeamRegistrationState.FORMING,
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'user-p2', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team Fire',
        tag: 'FIRE',
        gameId: 'game-1',
        inviteCode: 'JOIN12',
        captainId: 'user-cap',
        captain: { name: 'Captain' },
        acceptingSubstitutes: true,
        requireJoinApproval: true,
        registrationState: TeamRegistrationState.FORMING,
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN, user: { name: 'Captain', profilePic: null } },
          { userId: 'user-p2', role: TeamMemberRole.PLAYER, user: { name: 'Player 2', profilePic: null } },
        ],
      });
      mockPrisma.gameProfile.findUnique.mockResolvedValue({
        id: 'gp-1',
        userId: 'user-applicant',
        gameId: 'game-1',
        inGameUid: 'UID123',
        inGameName: 'ProPlayer',
      });
      mockPrisma.teamJoinRequest.count.mockResolvedValue(0);
      mockPrisma.teamJoinRequest.findFirst.mockResolvedValue(null);
      mockPrisma.teamJoinRequest.create.mockResolvedValue({
        id: 'req-1',
        teamId: 'team-1',
        userId: 'user-applicant',
        status: TeamJoinRequestStatus.PENDING,
        requestedAsSubstitute: false,
        createdAt: new Date(),
      });
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);

      const result = await teamsService.joinTeam('user-applicant', { invite_code: 'JOIN12' });

      expect(result.join_status).toBe('PENDING');
      expect(result.request.id).toBe('req-1');
      expect(result.request.status).toBe(TeamJoinRequestStatus.PENDING);
      expect(mockPrisma.teamMember.create).not.toHaveBeenCalled();
      // Pending request does not increment roster count
      expect(result.team.main_count).toBe(2);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('team.join_requested', expect.objectContaining({
        teamId: 'team-1',
        requestId: 'req-1',
      }));
    });

    it('2. a duplicate request is idempotent', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({
        id: 'team-1',
        name: 'Team Fire',
        gameId: 'game-1',
        inviteCode: 'JOIN12',
        captainId: 'user-cap',
        acceptingSubstitutes: true,
        requireJoinApproval: true,
        registrationState: TeamRegistrationState.FORMING,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team Fire',
        gameId: 'game-1',
        inviteCode: 'JOIN12',
        captainId: 'user-cap',
        captain: { name: 'Captain' },
        acceptingSubstitutes: true,
        requireJoinApproval: true,
        registrationState: TeamRegistrationState.FORMING,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN, user: { name: 'Captain' } }],
      });
      mockPrisma.gameProfile.findUnique.mockResolvedValue({
        id: 'gp-1',
        userId: 'user-applicant',
        gameId: 'game-1',
      });
      mockPrisma.teamJoinRequest.count.mockResolvedValue(1);
      // Existing pending request already found
      const existingReq = {
        id: 'req-existing',
        teamId: 'team-1',
        userId: 'user-applicant',
        status: TeamJoinRequestStatus.PENDING,
        requestedAsSubstitute: false,
        createdAt: new Date(),
      };
      mockPrisma.teamJoinRequest.findFirst.mockResolvedValue(existingReq);
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);

      const result = await teamsService.joinTeam('user-applicant', { invite_code: 'JOIN12' });

      expect(result.join_status).toBe('PENDING');
      expect(result.request.id).toBe('req-existing');
      // Did NOT create a second request
      expect(mockPrisma.teamJoinRequest.create).not.toHaveBeenCalled();
    });

    it('3. approve adds the member and syncs the squad', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team Fire',
        captainId: 'user-cap',
        acceptingSubstitutes: true,
        registrationState: TeamRegistrationState.FORMING,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.teamJoinRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        teamId: 'team-1',
        userId: 'user-applicant',
        status: TeamJoinRequestStatus.PENDING,
        requestedAsSubstitute: false,
      });
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.teamMember.create.mockResolvedValue({
        id: 'tm-1',
        teamId: 'team-1',
        userId: 'user-applicant',
        role: TeamMemberRole.PLAYER,
      });
      mockPrisma.teamJoinRequest.update.mockResolvedValue({
        id: 'req-1',
        userId: 'user-applicant',
        status: TeamJoinRequestStatus.APPROVED,
        resolvedBy: 'user-cap',
      });

      const res = await teamsService.approveJoinRequest('user-cap', 'team-1', 'req-1');

      expect(res.status).toBe('APPROVED');
      expect(mockPrisma.teamMember.create).toHaveBeenCalledWith({
        data: { teamId: 'team-1', userId: 'user-applicant', role: TeamMemberRole.PLAYER },
      });
      expect(mockSquadsService.syncTeamToSquad).toHaveBeenCalledWith('team-1');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('team.join_approved', expect.objectContaining({
        teamId: 'team-1',
        requesterId: 'user-applicant',
      }));
    });

    it('4. approve on a full roster returns ROSTER_FULL and the request stays PENDING', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        tournamentId: 'tour-1',
        acceptingSubstitutes: false,
        registrationState: TeamRegistrationState.FORMING,
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u2', role: TeamMemberRole.PLAYER },
          { userId: 'u3', role: TeamMemberRole.PLAYER },
          { userId: 'u4', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.teamJoinRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        teamId: 'team-1',
        userId: 'user-applicant',
        status: TeamJoinRequestStatus.PENDING,
        requestedAsSubstitute: false,
      });
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        teamMode: TeamMode.SQUAD,
      });
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);

      await expect(
        teamsService.approveJoinRequest('user-cap', 'team-1', 'req-1'),
      ).rejects.toThrow(BadRequestException);

      // Verify member is not created and request is not marked approved
      expect(mockPrisma.teamMember.create).not.toHaveBeenCalled();
      expect(mockPrisma.teamJoinRequest.update).not.toHaveBeenCalled();
    });

    it('5. reject and cancel work', async () => {
      // Reject
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
      });
      mockPrisma.teamJoinRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        teamId: 'team-1',
        userId: 'user-applicant',
        status: TeamJoinRequestStatus.PENDING,
      });
      mockPrisma.teamJoinRequest.update.mockResolvedValue({
        id: 'req-1',
        status: TeamJoinRequestStatus.REJECTED,
      });

      const rejectRes = await teamsService.rejectJoinRequest('user-cap', 'team-1', 'req-1');
      expect(rejectRes.status).toBe('REJECTED');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('team.join_rejected', expect.objectContaining({
        teamId: 'team-1',
        requesterId: 'user-applicant',
      }));

      // Cancel
      mockPrisma.teamJoinRequest.update.mockResolvedValue({
        id: 'req-1',
        status: TeamJoinRequestStatus.CANCELLED,
      });
      const cancelRes = await teamsService.cancelJoinRequest('user-applicant', 'req-1');
      expect(cancelRes.status).toBe('CANCELLED');
    });

    it('6. a non-owner approving gets 403', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'user-cap',
        members: [],
      });

      await expect(
        teamsService.approveJoinRequest('user-stranger', 'team-1', 'req-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('7. a locked roster blocks new requests', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({
        id: 'team-1',
        inviteCode: 'JOIN12',
        gameId: 'game-1',
        registrationState: TeamRegistrationState.CONFIRMED,
        members: [],
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        registrationState: TeamRegistrationState.CONFIRMED,
      });

      await expect(
        teamsService.joinTeam('user-applicant', { invite_code: 'JOIN12' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('8. the preview response contains no email/phone/uid/ign fields', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        gameId: 'game-1',
        teamMode: TeamMode.SQUAD,
      });
      mockPrisma.team.findFirst.mockResolvedValue({
        id: 'team-1',
        name: 'AlphaSquad',
        tag: 'ALPH',
        logoUrl: 'https://example.com/logo.png',
        inviteCode: 'CODE12',
        acceptingSubstitutes: true,
        requireJoinApproval: true,
        registrationState: TeamRegistrationState.FORMING,
        captainId: 'user-cap',
        captain: { id: 'user-cap', name: 'Leader Bob' },
        members: [
          {
            userId: 'user-cap',
            role: TeamMemberRole.CAPTAIN,
            user: {
              name: 'Leader Bob',
              profilePic: 'https://example.com/pic.png',
              email: 'bob@example.com',
              phone: '+1234567890',
            },
          },
        ],
      });
      mockPrisma.tournamentRegistration.findUnique.mockResolvedValue(null);
      mockPrisma.teamJoinRequest.findFirst.mockResolvedValue(null);

      const preview = await tournamentsService.previewTeamByCode('tour-1', 'CODE12', 'user-guest');

      expect(preview.id).toBe('team-1');
      expect(preview.name).toBe('AlphaSquad');
      expect(preview.responsible_person).toEqual({ name: 'Leader Bob', role: 'LEADER' });
      expect(preview.require_join_approval).toBe(true);
      expect(preview.members).toHaveLength(1);
      const member = preview.members[0];
      expect(member.name).toBe('Leader Bob');
      expect(member.avatar).toBe('https://example.com/pic.png');
      expect(member.role).toBe(TeamMemberRole.CAPTAIN);
      expect(member.roster_type).toBe('MAIN');
      // Verify NO private data leak
      expect(member).not.toHaveProperty('email');
      expect(member).not.toHaveProperty('phone');
      expect(member).not.toHaveProperty('in_game_uid');
      expect(member).not.toHaveProperty('in_game_name');
      expect(member).not.toHaveProperty('gameProfiles');
      expect(preview).not.toHaveProperty('gameProfiles');
    });

    it('9. require_join_approval=false still joins immediately', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({
        id: 'team-1',
        name: 'Team Open',
        tag: 'OPEN',
        gameId: 'game-1',
        inviteCode: 'OPEN12',
        captainId: 'user-cap',
        acceptingSubstitutes: true,
        requireJoinApproval: false,
        registrationState: TeamRegistrationState.FORMING,
        members: [{ userId: 'user-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team Open',
        tag: 'OPEN',
        gameId: 'game-1',
        inviteCode: 'OPEN12',
        captainId: 'user-cap',
        acceptingSubstitutes: true,
        requireJoinApproval: false,
        registrationState: TeamRegistrationState.FORMING,
        members: [
          { userId: 'user-cap', role: TeamMemberRole.CAPTAIN, user: { name: 'Cap' } },
          { userId: 'user-applicant', role: TeamMemberRole.PLAYER, user: { name: 'New' } },
        ],
      });
      mockPrisma.gameProfile.findUnique.mockResolvedValue({
        id: 'gp-1',
        userId: 'user-applicant',
        gameId: 'game-1',
      });
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);
      mockPrisma.teamMember.create.mockResolvedValue({
        id: 'tm-new',
        teamId: 'team-1',
        userId: 'user-applicant',
        role: TeamMemberRole.PLAYER,
      });

      const res = await teamsService.joinTeam('user-applicant', { invite_code: 'OPEN12' });

      expect(res.join_status).toBe('JOINED');
      expect(mockPrisma.teamMember.create).toHaveBeenCalled();
      expect(mockSquadsService.syncTeamToSquad).toHaveBeenCalledWith('team-1');
    });

    it('10. two concurrent approvals for the last slot: exactly one succeeds', async () => {
      let currentMembers = [
        { userId: 'm1', role: TeamMemberRole.CAPTAIN },
        { userId: 'm2', role: TeamMemberRole.PLAYER },
        { userId: 'm3', role: TeamMemberRole.PLAYER },
      ];

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          ...mockPrisma,
          team: {
            findUnique: jest.fn().mockImplementation(() =>
              Promise.resolve({
                id: 'team-1',
                captainId: 'user-cap',
                tournamentId: 'tour-1',
                acceptingSubstitutes: false,
                registrationState: TeamRegistrationState.FORMING,
                members: [...currentMembers],
              }),
            ),
          },
          teamJoinRequest: {
            findUnique: jest.fn().mockImplementation(({ where }: any) =>
              Promise.resolve({
                id: where.id,
                teamId: 'team-1',
                userId: where.id === 'req-1' ? 'u-app1' : 'u-app2',
                status: TeamJoinRequestStatus.PENDING,
                requestedAsSubstitute: false,
              }),
            ),
            update: jest.fn().mockResolvedValue({ status: TeamJoinRequestStatus.APPROVED }),
          },
          tournament: {
            findUnique: jest.fn().mockResolvedValue({ id: 'tour-1', teamMode: TeamMode.SQUAD }),
          },
          tournamentRegistration: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teamMember: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(({ data }: any) => {
              currentMembers.push({ userId: data.userId, role: data.role });
              return Promise.resolve({ id: 'tm-new', ...data });
            }),
          },
        };
        return callback(tx);
      });

      // Call first approval
      const firstApproval = await teamsService.approveJoinRequest('user-cap', 'team-1', 'req-1');
      expect(firstApproval.status).toBe('APPROVED');

      // Call second approval for the same last slot -> should fail with ROSTER_FULL
      await expect(
        teamsService.approveJoinRequest('user-cap', 'team-1', 'req-2'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
