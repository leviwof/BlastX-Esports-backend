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
import { TeamMemberRole, RegistrationStatus, TournamentStatus, TeamMode } from '@prisma/client';

describe('Teams & Tournaments Features', () => {
  let teamsService: TeamsService;
  let tournamentsService: TournamentsService;
  let mockPrisma: any;
  let mockEventEmitter: any;
  let mockConfig: any;

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
      },
      $transaction: jest.fn(async (cbOrArr) => {
        if (typeof cbOrArr === 'function') {
          return cbOrArr(mockPrisma);
        }
        return Promise.all(cbOrArr);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };

    mockEventEmitter = { emit: jest.fn() };
    mockConfig = { get: jest.fn() };

    teamsService = new TeamsService(mockPrisma);
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
      expect(preview.roster_info.main_players_count).toBe(2);
      expect(preview.roster_info.can_join_main).toBe(true);
      expect(preview.roster_info.can_join_substitute).toBe(true);
      expect(preview.roster_info.is_full).toBe(false);
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
        registration_status: null,
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
});
