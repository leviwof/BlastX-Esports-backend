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

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { SquadsService } from '../squads/squads.service';
import { RegistrationService } from '../tournaments/registration.service';
import { toTournamentResponse } from '../tournaments/tournament.mapper';
import { FilterTournamentQueryDto } from '../tournaments/dto/filter-tournament.dto';
import {
  TeamMemberRole,
  RegistrationStatus,
  TournamentStatus,
  TeamMode,
  SquadRole,
  TeamRegistrationState,
  TeamJoinRequestStatus,
  OwnerRole,
  RegistrationSubmissionStatus,
  RegistrationApprovalStatus,
  WaitlistEntryStatus,
  MatchStatus,
  RoundStatus,
} from '@prisma/client';

describe('Teams & Tournaments Features', () => {
  let teamsService: TeamsService;
  let tournamentsService: TournamentsService;
  let registrationService: RegistrationService;
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
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
      tournamentWaitlistEntry: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      match: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tournamentRound: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
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
      registrationSubmission: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      registrationApproval: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      registrationEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
      tournamentAuditLog: {
        create: jest.fn().mockResolvedValue({}),
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

    registrationService = new RegistrationService(mockPrisma, mockEventEmitter, mockConfig);
    teamsService = new TeamsService(mockPrisma, mockSquadsService as any, mockEventEmitter);
    tournamentsService = new TournamentsService(mockPrisma, mockEventEmitter, mockConfig, mockSquadsService as any, registrationService);
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
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'BlastX Championship',
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        teamMode: TeamMode.SQUAD,
        entryFee: 0,
        maxSlots: 16,
        registeredCount: 0,
      });
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
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'BlastX Championship',
        gameId: 'game-1',
        status: TournamentStatus.LIVE,
        teamMode: TeamMode.SQUAD,
        entryFee: 0,
        maxSlots: 16,
        registeredCount: 0,
      });
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
        registrationState: TeamRegistrationState.CONFIRMED,
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
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(existingReg);
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

      const res = await tournamentsService.registerUserOrTeam('user-cap2', 'tour-1', { team_id: 'team-2' });
      expect((res as any).registration_state).toBe(TeamRegistrationState.WAITLISTED);
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
            ...mockPrisma.team,
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

  describe('Section 3: Player Participation Approvals & Roster Management', () => {
    it('1. SQUAD with Leader in Playing 4 -> 3 approvals; Manager outside -> 4 approvals; DUO -> 1', async () => {
      // 1a. SQUAD with Leader
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-sq',
        title: 'Championship',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        teamMode: TeamMode.SQUAD,
        gameId: 'game-1',
        requirePlayerApproval: true,
      });
      mockPrisma.team.findUnique.mockResolvedValueOnce({
        id: 'team-sq1',
        name: 'Squad 1',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        gameId: 'game-1',
        registrationState: TeamRegistrationState.FORMING,
        rosterVersion: 1,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap' }, { userId: 'u-p1' }, { userId: 'u-p2' }, { userId: 'u-p3' }
      ]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.registrationSubmission.create.mockResolvedValue({
        id: 'sub-sq1',
        createdAt: new Date(),
      });
      mockPrisma.registrationApproval.findMany.mockResolvedValue([
        { id: 'app-1', userId: 'u-p1' },
        { id: 'app-2', userId: 'u-p2' },
        { id: 'app-3', userId: 'u-p3' },
      ]);

      const resSquadLeader = await registrationService.register('u-cap', 'tour-sq', { team_id: 'team-sq1' });
      expect(resSquadLeader.status).toBe('PENDING_APPROVAL');
      expect(resSquadLeader.approvals_required).toBe(3);
      expect(mockPrisma.registrationApproval.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 'u-p1' }),
          expect.objectContaining({ userId: 'u-p2' }),
          expect.objectContaining({ userId: 'u-p3' }),
        ]),
      });

      // 1b. SQUAD with Manager
      mockPrisma.team.findUnique.mockResolvedValueOnce({
        id: 'team-sq2',
        name: 'Squad 2',
        captainId: 'u-mgr',
        ownerRole: OwnerRole.MANAGER,
        gameId: 'game-1',
        registrationState: TeamRegistrationState.FORMING,
        rosterVersion: 1,
        members: [
          { userId: 'u-mgr', role: TeamMemberRole.MANAGER },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
          { userId: 'u-p4', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-p1' }, { userId: 'u-p2' }, { userId: 'u-p3' }, { userId: 'u-p4' }
      ]);
      mockPrisma.registrationApproval.findMany.mockResolvedValue([
        { id: 'app-1', userId: 'u-p1' },
        { id: 'app-2', userId: 'u-p2' },
        { id: 'app-3', userId: 'u-p3' },
        { id: 'app-4', userId: 'u-p4' },
      ]);
      const resSquadManager = await registrationService.register('u-mgr', 'tour-sq', { team_id: 'team-sq2' });
      expect(resSquadManager.approvals_required).toBe(4);

      // 1c. DUO with Leader
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-duo',
        title: 'Duo Cup',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
        requirePlayerApproval: true,
      });
      mockPrisma.team.findUnique.mockResolvedValueOnce({
        id: 'team-duo',
        name: 'Duo Team',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        gameId: 'game-1',
        registrationState: TeamRegistrationState.FORMING,
        rosterVersion: 1,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap' }, { userId: 'u-p1' }
      ]);
      mockPrisma.registrationApproval.findMany.mockResolvedValue([
        { id: 'app-1', userId: 'u-p1' },
      ]);
      const resDuo = await registrationService.register('u-cap', 'tour-duo', { team_id: 'team-duo' });
      expect(resDuo.approvals_required).toBe(1);
    });

    it('2. register twice is idempotent (one submission)', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'Championship',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        teamMode: TeamMode.SQUAD,
        gameId: 'game-1',
        requirePlayerApproval: true,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Alpha',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        gameId: 'game-1',
        registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
        rosterVersion: 1,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap' }, { userId: 'u-p1' }, { userId: 'u-p2' }, { userId: 'u-p3' }
      ]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.registrationSubmission.findFirst.mockResolvedValue({
        id: 'sub-existing',
        rosterVersion: 1,
        status: RegistrationSubmissionStatus.ACTIVE,
        createdAt: new Date(),
        approvals: [
          { id: 'app-1', status: RegistrationApprovalStatus.APPROVED },
          { id: 'app-2', status: RegistrationApprovalStatus.PENDING },
          { id: 'app-3', status: RegistrationApprovalStatus.PENDING },
        ],
      });

      const res = await registrationService.register('u-cap', 'tour-1', { team_id: 'team-1' });
      expect(res.id).toBe('sub-existing');
      expect(res.registration_state).toBe(TeamRegistrationState.PENDING_PLAYER_APPROVAL);
      expect(res.approvals_required).toBe(3);
      expect(res.approvals_approved).toBe(1);
      expect(mockPrisma.registrationSubmission.create).not.toHaveBeenCalled();
    });

    it('3. all approve -> CONFIRMED, slot number set, events fired once, registeredCount +1 once', async () => {
      const submission = {
        id: 'sub-1',
        rosterVersion: 1,
        status: RegistrationSubmissionStatus.ACTIVE,
        playingUserIds: ['u-cap', 'u-p1'],
        tournament: { id: 'tour-1', title: 'Tour 1', status: TournamentStatus.LIVE, maxSlots: 10, registeredCount: 4, entryFee: 0, teamMode: TeamMode.DUO },
        team: {
          id: 'team-1',
          name: 'Duo 1',
          captainId: 'u-cap',
          rosterVersion: 1,
          registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
          members: [
            { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
            { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          ],
        },
        approvals: [
          { id: 'app-1', userId: 'u-p1', status: RegistrationApprovalStatus.PENDING },
        ],
      };

      mockPrisma.registrationApproval.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'u-p1',
        status: RegistrationApprovalStatus.PENDING,
        submission,
      });
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'Tour 1',
        status: TournamentStatus.LIVE,
        maxSlots: 10,
        registeredCount: 5,
        entryFee: 0,
        teamMode: TeamMode.DUO,
      });
      mockPrisma.team.findUnique.mockResolvedValue(submission.team);
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap' },
        { userId: 'u-p1' },
      ]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([
        { slotNumber: 1 }, { slotNumber: 2 }, { slotNumber: 3 }, { slotNumber: 4 },
      ]);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournamentRegistration.create.mockResolvedValue({
        id: 'reg-1',
        slotNumber: 5,
        status: RegistrationStatus.CONFIRMED,
      });

      const res = await registrationService.approve('u-p1', 'app-1');

      expect(res.status).toBe('APPROVED');
      expect(res.all_approved).toBe(true);
      expect(res.registration_state).toBe('CONFIRMED');
      expect(res.slot_number).toBe(5);
      expect(mockPrisma.$transaction).toHaveBeenLastCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxWait: 10_000, timeout: 30_000 }),
      );
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { registrationState: TeamRegistrationState.CONFIRMED } }),
      );
      expect(mockPrisma.registrationSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: RegistrationSubmissionStatus.COMPLETED }) }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.slot_confirmed',
        expect.objectContaining({ slotNumber: 5 }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'registration.confirmed',
        expect.objectContaining({ slotNumber: 5 }),
      );
    });

    it('4. a decline -> ROSTER_CHANGE_REQUIRED and later approvals are blocked', async () => {
      const submission = {
        id: 'sub-1',
        rosterVersion: 1,
        status: RegistrationSubmissionStatus.ACTIVE,
        playingUserIds: ['u-cap', 'u-p1', 'u-p2', 'u-p3'],
        tournament: { id: 'tour-1', status: TournamentStatus.LIVE },
        team: {
          id: 'team-1',
          name: 'Squad 1',
          captainId: 'u-cap',
          rosterVersion: 1,
          registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
          members: [
            { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
            { userId: 'u-p1', role: TeamMemberRole.PLAYER },
            { userId: 'u-p2', role: TeamMemberRole.PLAYER },
            { userId: 'u-p3', role: TeamMemberRole.PLAYER },
          ],
        },
      };

      mockPrisma.registrationApproval.findUnique.mockResolvedValueOnce({
        id: 'app-1',
        userId: 'u-p1',
        status: RegistrationApprovalStatus.PENDING,
        submission,
      });

      const declineRes = await registrationService.decline('u-p1', 'app-1');
      expect(declineRes.status).toBe('DECLINED');
      expect(declineRes.registration_state).toBe(TeamRegistrationState.ROSTER_CHANGE_REQUIRED);
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { registrationState: TeamRegistrationState.ROSTER_CHANGE_REQUIRED } }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'registration.roster_change_required',
        expect.objectContaining({ ownerUserId: 'u-cap' }),
      );

      // Now later approver tries to approve
      mockPrisma.registrationApproval.findUnique.mockResolvedValueOnce({
        id: 'app-2',
        userId: 'u-p2',
        status: RegistrationApprovalStatus.PENDING,
        submission: {
          ...submission,
          team: {
            ...submission.team,
            registrationState: TeamRegistrationState.ROSTER_CHANGE_REQUIRED,
          },
        },
      });

      await expect(
        registrationService.approve('u-p2', 'app-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('5. remove/swap/transfer while pending -> submission SUPERSEDED, roster_version +1, state FORMING, approvers notified; old approval blocked', async () => {
      let members = [
        { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
        { userId: 'u-p1', role: TeamMemberRole.PLAYER },
        { userId: 'u-p2', role: TeamMemberRole.PLAYER },
        { userId: 'u-p3', role: TeamMemberRole.PLAYER },
      ];
      mockPrisma.team.findUnique.mockImplementation(() =>
        Promise.resolve({
          id: 'team-1',
          name: 'Team 1',
          captainId: 'u-cap',
          tournamentId: 'tour-1',
          rosterVersion: 1,
          registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
          members: [...members],
        }),
      );
      mockPrisma.teamMember.delete.mockImplementation(({ where }: any) => {
        members = members.filter((m) => m.userId !== where.unique_team_user.userId);
        return Promise.resolve({});
      });
      mockPrisma.registrationSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        status: RegistrationSubmissionStatus.ACTIVE,
        approvals: [
          { userId: 'u-p1', status: RegistrationApprovalStatus.PENDING },
          { userId: 'u-p2', status: RegistrationApprovalStatus.PENDING },
          { userId: 'u-p3', status: RegistrationApprovalStatus.PENDING },
        ],
      });

      const removeRes = await teamsService.removeMember('u-cap', 'team-1', 'u-p3');
      expect(removeRes.message).toBeDefined();
      expect(mockPrisma.registrationSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: { status: RegistrationSubmissionStatus.SUPERSEDED },
        }),
      );
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rosterVersion: 2,
            registrationState: TeamRegistrationState.FORMING,
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'registration.invalidated',
        expect.objectContaining({
          userIds: expect.arrayContaining(['u-p1', 'u-p2', 'u-p3', 'u-cap']),
        }),
      );

      // Now approve with old approval should fail with ROSTER_VERSION_MISMATCH
      mockPrisma.registrationApproval.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'u-p1',
        status: RegistrationApprovalStatus.PENDING,
        submission: {
          id: 'sub-1',
          rosterVersion: 1,
          status: RegistrationSubmissionStatus.SUPERSEDED,
          playingUserIds: ['u-cap', 'u-p1', 'u-p2', 'u-p3'],
          team: {
            id: 'team-1',
            rosterVersion: 2,
            registrationState: TeamRegistrationState.FORMING,
            members: [
              { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
              { userId: 'u-p1', role: TeamMemberRole.PLAYER },
              { userId: 'u-p2', role: TeamMemberRole.PLAYER },
            ],
          },
          tournament: { id: 'tour-1', status: TournamentStatus.LIVE },
        },
      });

      await expect(
        registrationService.approve('u-p1', 'app-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('6. substitute joining/leaving does not invalidate anything', async () => {
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team 1',
        captainId: 'u-cap',
        tournamentId: 'tour-1',
        rosterVersion: 1,
        registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
          { userId: 'u-sub', role: TeamMemberRole.SUBSTITUTE },
        ],
      });

      await teamsService.leaveTeam('u-sub', 'team-1');
      expect(mockPrisma.registrationSubmission.update).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('registration.invalidated', expect.anything());
    });

    it('7. a non-approver gets NOT_APPROVER (403)', async () => {
      mockPrisma.registrationApproval.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'u-p1',
        status: RegistrationApprovalStatus.PENDING,
        submission: {
          team: { members: [] },
          tournament: {},
          playingUserIds: [],
        },
      });

      await expect(
        registrationService.approve('u-intruder', 'app-1'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        registrationService.decline('u-intruder', 'app-1'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        registrationService.getApprovalById('u-intruder', 'app-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('8. capacity full on last approval -> WAITLISTED; concurrent approvals for last slot -> exactly one CONFIRMED', async () => {
      const submission = {
        id: 'sub-1',
        rosterVersion: 1,
        status: RegistrationSubmissionStatus.ACTIVE,
        playingUserIds: ['u-cap', 'u-p1'],
        tournament: { id: 'tour-1', title: 'Tour 1', status: TournamentStatus.LIVE, maxSlots: 10, registeredCount: 10, entryFee: 0, teamMode: TeamMode.DUO },
        team: {
          id: 'team-1',
          name: 'Duo 1',
          captainId: 'u-cap',
          rosterVersion: 1,
          registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
          members: [
            { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
            { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          ],
        },
        approvals: [
          { id: 'app-1', userId: 'u-p1', status: RegistrationApprovalStatus.PENDING },
        ],
      };

      mockPrisma.registrationApproval.findUnique.mockResolvedValue({
        id: 'app-1',
        userId: 'u-p1',
        status: RegistrationApprovalStatus.PENDING,
        submission,
      });
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'Tour 1',
        status: TournamentStatus.LIVE,
        maxSlots: 10,
        registeredCount: 10,
        entryFee: 0,
        teamMode: TeamMode.DUO,
      });
      mockPrisma.team.findUnique.mockResolvedValue(submission.team);
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap' },
        { userId: 'u-p1' },
      ]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 0 });

      const res = await registrationService.approve('u-p1', 'app-1');

      expect(res.registration_state).toBe('WAITLISTED');
      expect(res.slot_number).toBeNull();
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { registrationState: TeamRegistrationState.WAITLISTED } }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.waitlisted',
        expect.objectContaining({ tournamentId: 'tour-1' }),
      );
    });

    it('9. require_player_approval=false -> immediate CONFIRMED', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'Instant Tour',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
        requirePlayerApproval: false,
        maxSlots: 10,
        registeredCount: 2,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Duo Instant',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        gameId: 'game-1',
        registrationState: TeamRegistrationState.FORMING,
        rosterVersion: 1,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap' }, { userId: 'u-p1' }
      ]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([{ slotNumber: 1 }]);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournamentRegistration.create.mockResolvedValue({
        id: 'reg-instant',
        slotNumber: 2,
        status: RegistrationStatus.CONFIRMED,
      });

      const res = await registrationService.register('u-cap', 'tour-1', { team_id: 'team-1' });

      expect(res.registration_state).toBe('CONFIRMED');
      expect(res.slot_number).toBe(2);
      expect(mockPrisma.registrationApproval.createMany).not.toHaveBeenCalled();
    });

    it('10. cancel-request works; ask again after decline works', async () => {
      // 10a. Cancel request
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team 1',
        captainId: 'u-cap',
        gameId: 'game-1',
        registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
        rosterVersion: 1,
        members: [{ userId: 'u-cap', role: TeamMemberRole.CAPTAIN }],
      });
      mockPrisma.registrationSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        approvals: [{ userId: 'u-p1', status: RegistrationApprovalStatus.PENDING }],
      });

      const cancelRes = await registrationService.cancelRegistrationRequest('u-cap', 'tour-1', 'team-1');
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.registration_state).toBe(TeamRegistrationState.FORMING);
      expect(mockPrisma.registrationSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sub-1' }, data: { status: RegistrationSubmissionStatus.CANCELLED } }),
      );

      // 10b. Ask again after decline (ROSTER_CHANGE_REQUIRED)
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-1',
        title: 'Tour 1',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
        requirePlayerApproval: true,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        name: 'Team 1',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        gameId: 'game-1',
        registrationState: TeamRegistrationState.ROSTER_CHANGE_REQUIRED,
        rosterVersion: 1,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([{ userId: 'u-cap' }, { userId: 'u-p1' }]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.registrationSubmission.create.mockResolvedValue({
        id: 'sub-2',
        createdAt: new Date(),
      });
      mockPrisma.registrationApproval.findMany.mockResolvedValue([{ id: 'app-new', userId: 'u-p1' }]);

      const askAgainRes = await registrationService.register('u-cap', 'tour-1', { team_id: 'team-1' });
      expect(askAgainRes.status).toBe('PENDING_APPROVAL');
      expect(askAgainRes.registration_state).toBe(TeamRegistrationState.PENDING_PLAYER_APPROVAL);
    });

    it('11. PUT playing-roster validations (LEADER_MUST_PLAY, MANAGER_CANNOT_PLAY, wrong count, substitute limit)', async () => {
      // 11a. LEADER_MUST_PLAY
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        tournamentId: 'tour-1',
        registrationState: TeamRegistrationState.FORMING,
        acceptingSubstitutes: true,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
          { userId: 'u-p4', role: TeamMemberRole.PLAYER },
        ],
        tournament: { teamMode: TeamMode.SQUAD },
      });

      await expect(
        teamsService.updatePlayingRoster('u-cap', 'team-1', ['u-p1', 'u-p2', 'u-p3', 'u-p4']),
      ).rejects.toThrow(BadRequestException);

      // 11b. MANAGER_CANNOT_PLAY
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-2',
        captainId: 'u-mgr',
        ownerRole: OwnerRole.MANAGER,
        tournamentId: 'tour-1',
        registrationState: TeamRegistrationState.FORMING,
        acceptingSubstitutes: true,
        members: [
          { userId: 'u-mgr', role: TeamMemberRole.MANAGER },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
        ],
        tournament: { teamMode: TeamMode.SQUAD },
      });

      await expect(
        teamsService.updatePlayingRoster('u-mgr', 'team-2', ['u-mgr', 'u-p1', 'u-p2', 'u-p3']),
      ).rejects.toThrow(BadRequestException);

      // 11c. Wrong count
      await expect(
        teamsService.updatePlayingRoster('u-mgr', 'team-2', ['u-p1', 'u-p2']),
      ).rejects.toThrow(BadRequestException);

      // 11d. Locked when CONFIRMED
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-3',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        tournamentId: 'tour-1',
        registrationState: TeamRegistrationState.CONFIRMED,
        members: [{ userId: 'u-cap', role: TeamMemberRole.CAPTAIN }],
        tournament: { teamMode: TeamMode.SQUAD },
      });

      await expect(
        teamsService.updatePlayingRoster('u-cap', 'team-3', ['u-cap', 'u-p1', 'u-p2', 'u-p3']),
      ).rejects.toThrow(BadRequestException);
    });

    it('12. SOLO and a paid tournament behave exactly as before', async () => {
      // 12a. Paid tournament
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-paid',
        status: TournamentStatus.LIVE,
        entryFee: 100,
        teamMode: TeamMode.SOLO,
      });
      mockConfig.get.mockReturnValue('false');

      await expect(
        registrationService.register('u-solo', 'tour-paid', {}),
      ).rejects.toThrow(BadRequestException);

      // 12b. SOLO tournament
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-solo',
        title: 'Solo Cup',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        teamMode: TeamMode.SOLO,
        gameId: 'game-1',
        maxSlots: 10,
        registeredCount: 0,
      });
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.gameProfile.findUnique.mockResolvedValue({ id: 'gp-solo' });
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournamentRegistration.create.mockResolvedValue({
        id: 'reg-solo',
        status: RegistrationStatus.CONFIRMED,
        slotNumber: 1,
      });

      const resSolo = await registrationService.register('u-solo', 'tour-solo', {});
      expect(resSolo.status).toBe(RegistrationStatus.CONFIRMED);
      expect(resSolo.slotNumber).toBe(1);
    });

    it('13. every step writes registration_events rows', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-sq',
        title: 'Championship',
        status: TournamentStatus.LIVE,
        entryFee: 0,
        teamMode: TeamMode.SQUAD,
        gameId: 'game-1',
        requirePlayerApproval: true,
      });
      mockPrisma.team.findUnique.mockResolvedValue({
        id: 'team-sq1',
        name: 'Squad 1',
        captainId: 'u-cap',
        ownerRole: OwnerRole.LEADER,
        gameId: 'game-1',
        registrationState: TeamRegistrationState.FORMING,
        rosterVersion: 1,
        members: [
          { userId: 'u-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
          { userId: 'u-p3', role: TeamMemberRole.PLAYER },
        ],
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap' }, { userId: 'u-p1' }, { userId: 'u-p2' }, { userId: 'u-p3' }
      ]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.registrationSubmission.create.mockResolvedValue({ id: 'sub-sq1', createdAt: new Date() });
      mockPrisma.registrationApproval.findMany.mockResolvedValue([
        { id: 'app-1', userId: 'u-p1' },
      ]);

      await registrationService.register('u-cap', 'tour-sq', { team_id: 'team-sq1' });
      expect(mockPrisma.registrationEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'SUBMISSION_CREATED' }),
        }),
      );
    });
  });

  describe('Section 4: Waitlist Queue, Real Slot Capacity & Automatic Promotion', () => {
    it('1. full tournament -> team becomes WAITLISTED with position 1; second team position 2', async () => {
      const tourney = {
        id: 'tour-full',
        title: 'Full Tour',
        status: TournamentStatus.LIVE,
        maxSlots: 10,
        registeredCount: 10,
        entryFee: 0,
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
      };
      const team1 = {
        id: 'team-w1',
        tournamentId: 'tour-full',
        captainId: 'u-cap1',
        members: [
          { userId: 'u-cap1', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p1', role: TeamMemberRole.PLAYER },
        ],
      };
      const team2 = {
        id: 'team-w2',
        tournamentId: 'tour-full',
        captainId: 'u-cap2',
        members: [
          { userId: 'u-cap2', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-p2', role: TeamMemberRole.PLAYER },
        ],
      };

      mockPrisma.tournament.findUnique.mockResolvedValue(tourney);
      mockPrisma.team.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.id === 'team-w1') return team1;
        if (where.id === 'team-w2') return team2;
        return null;
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-cap1' }, { userId: 'u-p1' }, { userId: 'u-cap2' }, { userId: 'u-p2' }
      ]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 0 }); // Capacity full!

      // Team 1 registers -> position 1
      mockPrisma.tournamentWaitlistEntry.findUnique.mockResolvedValue(null);
      mockPrisma.tournamentWaitlistEntry.create.mockResolvedValue({
        id: 'we-1',
        tournamentId: 'tour-full',
        teamId: 'team-w1',
        status: WaitlistEntryStatus.WAITING,
        createdAt: new Date(1000),
      });
      mockPrisma.tournamentWaitlistEntry.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      const res1 = await registrationService.finalizeRegistration(mockPrisma, 'tour-full', 'team-w1', 'u-cap1');
      expect(res1.status).toBe('WAITLISTED');
      expect(res1.position).toBe(1);
      expect(res1.size).toBe(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.waitlisted',
        expect.objectContaining({ teamId: 'team-w1', position: 1, size: 1 }),
      );

      // Team 2 registers -> position 2
      mockPrisma.tournamentWaitlistEntry.findUnique.mockResolvedValue(null);
      mockPrisma.tournamentWaitlistEntry.create.mockResolvedValue({
        id: 'we-2',
        tournamentId: 'tour-full',
        teamId: 'team-w2',
        status: WaitlistEntryStatus.WAITING,
        createdAt: new Date(2000),
      });
      mockPrisma.tournamentWaitlistEntry.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      const res2 = await registrationService.finalizeRegistration(mockPrisma, 'tour-full', 'team-w2', 'u-cap2');
      expect(res2.status).toBe('WAITLISTED');
      expect(res2.position).toBe(2);
      expect(res2.size).toBe(2);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.waitlisted',
        expect.objectContaining({ teamId: 'team-w2', position: 2, size: 2 }),
      );
    });

    it('2. an unregister frees a slot -> the first team is promoted automatically, gets the LOWEST free slot number, notifications fire once', async () => {
      const tourney = {
        id: 'tour-unreg',
        title: 'Unreg Tour',
        status: TournamentStatus.LIVE,
        maxSlots: 5,
        registeredCount: 5,
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
      };
      const unregTeam = {
        id: 'team-unreg',
        tournamentId: 'tour-unreg',
        captainId: 'u-unreg-cap',
        registrationState: TeamRegistrationState.CONFIRMED,
        members: [{ userId: 'u-unreg-cap', role: TeamMemberRole.CAPTAIN }],
        waitlistEntries: [],
      };
      const waitingTeam = {
        id: 'team-w1',
        tournamentId: 'tour-unreg',
        captainId: 'u-wait-cap',
        registrationState: TeamRegistrationState.WAITLISTED,
        rosterVersion: 1,
        members: [
          { userId: 'u-wait-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-wait-p1', role: TeamMemberRole.PLAYER },
        ],
        registrationSubmissions: [
          { id: 'sub-w1', status: RegistrationSubmissionStatus.ACTIVE },
        ],
      };

      let currentRegisteredCount = 5;
      mockPrisma.tournament.findUnique.mockImplementation(async () => ({
        ...tourney,
        registeredCount: currentRegisteredCount,
      }));
      mockPrisma.tournament.update.mockImplementation(async ({ data }: any) => {
        if (data.registeredCount?.decrement) currentRegisteredCount--;
        return { ...tourney, registeredCount: currentRegisteredCount };
      });
      mockPrisma.tournament.updateMany.mockImplementation(async ({ data }: any) => {
        if (data.registeredCount?.increment) currentRegisteredCount++;
        return { count: 1 };
      });
      mockPrisma.match.findFirst.mockResolvedValue(null);
      mockPrisma.tournamentRound.findFirst.mockResolvedValue(null);

      mockPrisma.team.findFirst.mockImplementation(async ({ where }: any) => {
        if (where.members?.some?.userId === 'u-unreg-cap') return unregTeam;
        return null;
      });

      mockPrisma.tournamentRegistration.findFirst.mockImplementation(async ({ where }: any) => {
        if (where.teamId === 'team-unreg') {
          return { id: 'reg-unreg', tournamentId: 'tour-unreg', teamId: 'team-unreg', slotNumber: 1, status: RegistrationStatus.CONFIRMED };
        }
        return null;
      });

      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([
        { slotNumber: 2 },
        { slotNumber: 3 },
        { slotNumber: 4 },
        { slotNumber: 5 },
      ]);

      let waitlistPromoted = false;
      mockPrisma.tournamentWaitlistEntry.findFirst.mockImplementation(async () => {
        if (!waitlistPromoted) {
          return {
            id: 'we-1',
            tournamentId: 'tour-unreg',
            teamId: 'team-w1',
            status: WaitlistEntryStatus.WAITING,
            createdAt: new Date(1000),
            team: waitingTeam,
          };
        }
        return null;
      });

      mockPrisma.tournamentWaitlistEntry.updateMany.mockImplementation(async () => {
        waitlistPromoted = true;
        return { count: 1 };
      });

      mockPrisma.gameProfile.findMany.mockResolvedValue([
        { userId: 'u-wait-cap' },
        { userId: 'u-wait-p1' },
      ]);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });

      const res = await tournamentsService.unregisterUserOrTeam('u-unreg-cap', 'tour-unreg');
      expect(res.message).toBe('Successfully unregistered from tournament');

      expect(mockPrisma.tournamentRegistration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tournamentId: 'tour-unreg',
            teamId: 'team-w1',
            slotNumber: 1,
            status: RegistrationStatus.CONFIRMED,
          }),
        }),
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.waitlist_promoted',
        expect.objectContaining({
          teamId: 'team-w1',
          slotNumber: 1,
          userIds: expect.arrayContaining(['u-wait-cap', 'u-wait-p1']),
        }),
      );
    });

    it('3. admin disqualify and admin max_slots increase promote correctly (for increase, several teams may be promoted)', async () => {
      const tourney = {
        id: 'tour-admin',
        title: 'Admin Tour',
        status: TournamentStatus.LIVE,
        maxSlots: 10,
        registeredCount: 10,
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
      };

      // Case A: Disqualify
      mockPrisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-dq',
        tournamentId: 'tour-admin',
        teamId: 'team-dq',
        status: RegistrationStatus.CONFIRMED,
        team: { id: 'team-dq', rosterVersion: 1 },
      });
      mockPrisma.tournament.findUnique.mockResolvedValue({ ...tourney, registeredCount: 9 });
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);
      mockPrisma.tournamentWaitlistEntry.findFirst.mockResolvedValue(null);

      await tournamentsService.disqualifyRegistration('admin-1', 'tour-admin', { registration_id: 'reg-dq', reason: 'Rule violation' });
      expect(mockPrisma.tournament.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { registeredCount: { decrement: 1 } } }),
      );

      // Case B: max_slots increase from 10 to 12
      let currentMaxSlots = 10;
      let adminRegisteredCount = 10;
      mockPrisma.tournament.findUnique.mockImplementation(async () => ({
        ...tourney,
        maxSlots: currentMaxSlots,
        registeredCount: adminRegisteredCount,
      }));
      mockPrisma.tournament.update.mockImplementation(async ({ data }: any) => {
        if (data.maxSlots) currentMaxSlots = data.maxSlots;
        return { ...tourney, maxSlots: currentMaxSlots, registeredCount: adminRegisteredCount };
      });
      mockPrisma.tournament.updateMany.mockImplementation(async ({ data }: any) => {
        if (data.registeredCount?.increment) adminRegisteredCount++;
        if (data.registeredCount?.decrement) adminRegisteredCount--;
        return { count: 1 };
      });

      let promotionsLeft = 2;
      mockPrisma.tournamentWaitlistEntry.findFirst.mockImplementation(async () => {
        if (promotionsLeft > 0) {
          const tId = `team-promoted-${promotionsLeft}`;
          return {
            id: `we-${promotionsLeft}`,
            tournamentId: 'tour-admin',
            teamId: tId,
            status: WaitlistEntryStatus.WAITING,
            createdAt: new Date(),
            team: {
              id: tId,
              tournamentId: 'tour-admin',
              captainId: `cap-${promotionsLeft}`,
              members: [
                { userId: `cap-${promotionsLeft}`, role: TeamMemberRole.CAPTAIN },
                { userId: `p-${promotionsLeft}`, role: TeamMemberRole.PLAYER },
              ],
            },
          };
        }
        return null;
      });
      mockPrisma.tournamentWaitlistEntry.updateMany.mockImplementation(async () => {
        promotionsLeft--;
        return { count: 1 };
      });
      mockPrisma.gameProfile.findMany.mockResolvedValue([{ userId: '1' }, { userId: '2' }]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });

      await tournamentsService.updateTournament('admin-1', 'tour-admin', { max_slots: 12 });
      expect(promotionsLeft).toBe(0);
    });

    it('4. an invalid waiting team becomes INVALID and the next one is promoted', async () => {
      const tourney = {
        id: 'tour-inv',
        title: 'Invalid Tour',
        status: TournamentStatus.LIVE,
        maxSlots: 10,
        registeredCount: 9,
        teamMode: TeamMode.DUO,
        gameId: 'game-1',
      };
      const invalidTeam = {
        id: 'team-invalid',
        tournamentId: 'tour-inv',
        captainId: 'u-inv-cap',
        members: [{ userId: 'u-inv-cap', role: TeamMemberRole.CAPTAIN }],
      };
      const validTeam = {
        id: 'team-valid',
        tournamentId: 'tour-inv',
        captainId: 'u-val-cap',
        members: [
          { userId: 'u-val-cap', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-val-p1', role: TeamMemberRole.PLAYER },
        ],
      };

      mockPrisma.tournament.findUnique.mockResolvedValue(tourney);
      let step = 0;
      mockPrisma.tournamentWaitlistEntry.findFirst.mockImplementation(async () => {
        if (step === 0) {
          step++;
          return {
            id: 'we-invalid',
            tournamentId: 'tour-inv',
            teamId: 'team-invalid',
            status: WaitlistEntryStatus.WAITING,
            createdAt: new Date(1000),
            team: invalidTeam,
          };
        }
        if (step === 1) {
          step++;
          return {
            id: 'we-valid',
            tournamentId: 'tour-inv',
            teamId: 'team-valid',
            status: WaitlistEntryStatus.WAITING,
            createdAt: new Date(2000),
            team: validTeam,
          };
        }
        return null;
      });

      mockPrisma.gameProfile.findMany.mockResolvedValue([{ userId: 'u-val-cap' }, { userId: 'u-val-p1' }]);
      mockPrisma.tournamentRegistration.findFirst.mockResolvedValue(null);
      mockPrisma.tournamentWaitlistEntry.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournament.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([]);

      const result = await registrationService.promoteFromWaitlist('tour-inv');
      expect(result.invalidatedCount).toBe(1);
      expect(result.promotedCount).toBe(1);

      expect(mockPrisma.tournamentWaitlistEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'we-invalid' },
          data: expect.objectContaining({ status: WaitlistEntryStatus.INVALID }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.waitlist_invalidated',
        expect.objectContaining({
          ownerUserId: 'u-inv-cap',
          teamId: 'team-invalid',
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'tournament.waitlist_promoted',
        expect.objectContaining({
          teamId: 'team-valid',
        }),
      );
    });

    it('5. waitlisted owner leaves the queue; a non-owner cannot unregister the team', async () => {
      const tourney = {
        id: 'tour-leave',
        title: 'Leave Tour',
        status: TournamentStatus.LIVE,
        maxSlots: 10,
        registeredCount: 10,
        teamMode: TeamMode.DUO,
      };
      const team = {
        id: 'team-w',
        tournamentId: 'tour-leave',
        captainId: 'u-owner',
        registrationState: TeamRegistrationState.WAITLISTED,
        members: [
          { userId: 'u-owner', role: TeamMemberRole.CAPTAIN },
          { userId: 'u-regular', role: TeamMemberRole.PLAYER },
        ],
        waitlistEntries: [{ id: 'we-leave', status: WaitlistEntryStatus.WAITING }],
      };

      mockPrisma.tournament.findUnique.mockResolvedValue(tourney);
      mockPrisma.match.findFirst.mockResolvedValue(null);
      mockPrisma.tournamentRound.findFirst.mockResolvedValue(null);
      mockPrisma.team.findFirst.mockResolvedValue(team);

      // Non-owner gets NOT_TEAM_OWNER (403)
      await expect(
        tournamentsService.unregisterUserOrTeam('u-regular', 'tour-leave'),
      ).rejects.toThrow(ForbiddenException);

      // Owner successfully leaves waitlist
      const res = await tournamentsService.unregisterUserOrTeam('u-owner', 'tour-leave');
      expect(res.message).toBe('Successfully removed from waitlist');
      expect(mockPrisma.tournamentWaitlistEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WaitlistEntryStatus.REMOVED }),
        }),
      );
      // registeredCount was NOT decremented
      expect(mockPrisma.tournament.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { registeredCount: { decrement: 1 } } }),
      );
    });

    it('6. unregister after a match went LIVE returns COMPETITION_STARTED', async () => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-live-match',
        status: TournamentStatus.LIVE,
      });
      mockPrisma.match.findFirst.mockResolvedValue({ id: 'match-1', status: MatchStatus.LIVE });

      await expect(
        tournamentsService.unregisterUserOrTeam('u-cap', 'tour-live-match'),
      ).rejects.toThrow(BadRequestException);
    });

    it('7. concurrent promotion/registration never exceeds max_slots and never reuses a slot number', async () => {
      mockPrisma.tournamentRegistration.findMany.mockResolvedValue([
        { slotNumber: 1 },
        { slotNumber: 3 },
      ]);
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: 'tour-atomic',
        status: TournamentStatus.LIVE,
        maxSlots: 3,
        registeredCount: 2,
      });

      mockPrisma.tournament.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      mockPrisma.tournamentRegistration.count.mockResolvedValue(2);
      const recount = await registrationService.recountConfirmedRegistrations('tour-atomic');
      expect(recount).toBe(2);
      expect(mockPrisma.tournament.update).toHaveBeenCalledWith({
        where: { id: 'tour-atomic' },
        data: { registeredCount: 2 },
      });
    });

    it('8. list endpoints return my_registration without N+1 (log the query count)', async () => {
      const tourneyList = [
        { id: 't1', title: 'T1', maxSlots: 10, registeredCount: 2, registrationOpensAt: new Date(), registrationClosesAt: new Date() },
        { id: 't2', title: 'T2', maxSlots: 10, registeredCount: 10, registrationOpensAt: new Date(), registrationClosesAt: new Date() },
        { id: 't3', title: 'T3', maxSlots: 10, registeredCount: 5, registrationOpensAt: new Date(), registrationClosesAt: new Date() },
      ];

      mockPrisma.tournament.findMany.mockResolvedValue(tourneyList);
      mockPrisma.tournament.count.mockResolvedValue(3);
      mockPrisma.tournament.groupBy.mockResolvedValue([]);

      mockPrisma.tournamentWaitlistEntry.groupBy.mockResolvedValue([
        { tournamentId: 't2', _count: { id: 3 } },
      ]);
      mockPrisma.team.findMany.mockResolvedValue([
        {
          id: 'team-user',
          tournamentId: 't1',
          captainId: 'u-query-check',
          ownerRole: OwnerRole.LEADER,
          registrationState: TeamRegistrationState.CONFIRMED,
          members: [{ userId: 'u-query-check', role: TeamMemberRole.CAPTAIN }],
          waitlistEntries: [],
          registrationSubmissions: [
            {
              id: 'sub-t1',
              playingUserIds: ['u-query-check'],
              approvals: [{ id: 'app-t1', userId: 'u-query-check', status: 'APPROVED' }],
            },
          ],
        },
      ]);
      mockPrisma.tournamentRegistration.findMany
        .mockResolvedValueOnce([]) // solo
        .mockResolvedValueOnce([{ tournamentId: 't1', teamId: 'team-user', slotNumber: 1, status: RegistrationStatus.CONFIRMED }]); // team

      const initialQueryCount =
        mockPrisma.team.findMany.mock.calls.length +
        mockPrisma.tournamentRegistration.findMany.mock.calls.length +
        mockPrisma.tournamentWaitlistEntry.groupBy.mock.calls.length;

      const queryDto = Object.assign(new FilterTournamentQueryDto(), { page: 1, limit: 10 });
      const result = await tournamentsService.getTournaments(queryDto, undefined, false, 'u-query-check');

      const afterQueryCount =
        mockPrisma.team.findMany.mock.calls.length +
        mockPrisma.tournamentRegistration.findMany.mock.calls.length +
        mockPrisma.tournamentWaitlistEntry.groupBy.mock.calls.length;

      const queriesExecuted = afterQueryCount - initialQueryCount;
      console.log(`[QUERY_COUNT_TEST] Batched queries executed for 3 tournaments: ${queriesExecuted}`);
      expect(queriesExecuted).toBeLessThanOrEqual(4);

      const t1Response = toTournamentResponse(result.items[0], 'u-query-check');
      expect(t1Response.my_registration).toEqual(
        expect.objectContaining({
          state: 'CONFIRMED',
          team_id: 'team-user',
          slot_number: 1,
          my_role: 'LEADER',
          is_playing: true,
        }),
      );

      const t3Response = toTournamentResponse(result.items[2], 'u-query-check');
      expect(t3Response.my_registration).toBeNull();
      expect(t3Response.slots_left).toBe(5);
      expect(t3Response.is_full).toBe(false);
    });
  });
});
