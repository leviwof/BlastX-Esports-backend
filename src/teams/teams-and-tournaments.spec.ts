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
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tournament: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
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
  });
});
