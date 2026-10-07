jest.mock('@nestjs/event-emitter', () => ({
  EventEmitter2: class MockEventEmitter {
    emit = jest.fn();
  },
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SquadRole, SquadRosterType, TournamentInvitationStatus, TournamentStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { SquadsService } from './squads.service';

describe('SquadsService', () => {
  let service: SquadsService;
  let prisma: any;
  let events: { emit: jest.Mock };

  beforeEach(() => {
    const tx = {
      squadMember: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      squad: { update: jest.fn() },
      teamMember: { create: jest.fn(), findFirst: jest.fn() },
      tournamentRegistration: { findFirst: jest.fn() },
      tournamentInvitation: { update: jest.fn(), updateMany: jest.fn() },
    };
    prisma = {
      squadMember: {
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      squad: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      team: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      gameProfile: {
        count: jest.fn(),
      },
      tournament: {
        findUnique: jest.fn(),
      },
      tournamentInvitation: {
        findUnique: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      tournamentRegistration: { findFirst: jest.fn() },
      teamMember: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cbOrArr: any) => {
        if (typeof cbOrArr === 'function') {
          return cbOrArr(tx);
        }
        return Promise.all(cbOrArr);
      }),
      tx,
    };
    events = { emit: jest.fn() };
    service = new SquadsService(prisma as PrismaService, events as unknown as EventEmitter2);
  });

  it('returns the success envelope with a null squad when the user has no membership', async () => {
    prisma.squadMember.findUnique.mockResolvedValue(null);

    await expect(service.getMySquad('user-1')).resolves.toEqual({
      status: 'success',
      data: { squad: null },
    });
  });

  it('returns the specified persistent squad response shape', async () => {
    const joinedAt = new Date('2026-02-15T10:00:00.000Z');
    const createdAt = new Date('2026-02-15T10:00:00.000Z');
    prisma.squadMember.findUnique.mockResolvedValue({ squadId: 'squad-1' });
    prisma.squad.findUnique.mockResolvedValue({
      id: 'squad-1',
      name: 'ALPHA ELITE',
      tag: 'AEL',
      logoUrl: 'https://cdn.blastx.gg/logos/squad_alpha.png',
      leaderId: 'leader-1',
      ownerRole: 'LEADER',
      maxMainPlayers: 4,
      maxSubstitutes: 2,
      createdAt,
      game: { id: 'game-1', slug: 'free_fire', name: 'Free Fire' },
      members: [
        {
          userId: 'leader-1',
          role: 'LEADER',
          rosterType: 'MAIN',
          joinedAt,
          user: {
            id: 'leader-1',
            name: 'Phoenix Captain',
            profilePic: 'https://cdn.blastx.gg/avatars/p1.png',
            gameProfiles: [
              { gameId: 'game-1', inGameName: '★PHOENIX★', inGameUid: '827364129' },
            ],
          },
        },
      ],
    });

    await expect(service.getMySquad('leader-1')).resolves.toEqual({
      status: 'success',
      data: {
        squad: {
          id: 'squad-1',
          name: 'ALPHA ELITE',
          tag: 'AEL',
          logo_url: 'https://cdn.blastx.gg/logos/squad_alpha.png',
          leader_id: 'leader-1',
          owner_role: 'LEADER',
          max_main_players: 4,
          max_substitutes: 2,
          created_at: createdAt,
          members: [
            {
              user_id: 'leader-1',
              name: 'Phoenix Captain',
              role: 'LEADER',
              roster_type: 'MAIN',
              joined_at: joinedAt,
              user: {
                id: 'leader-1',
                name: 'Phoenix Captain',
                profile_pic: 'https://cdn.blastx.gg/avatars/p1.png',
                game_profile: {
                  in_game_name: '★PHOENIX★',
                  in_game_uid: '827364129',
                },
              },
            },
          ],
        },
      },
    });
  });

  it('enforces leader-only squad management', async () => {
    prisma.squad.findUnique.mockResolvedValue({ id: 'squad-1', leaderId: 'leader-1' });

    await expect(service.removeMember('other-user', 'squad-1', 'member-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('prevents promoting into a full main roster', async () => {
    prisma.squad.findUnique.mockResolvedValue({
      id: 'squad-1',
      leaderId: 'leader-1',
      maxMainPlayers: 4,
      maxSubstitutes: 2,
    });
    prisma.squadMember.findUnique.mockResolvedValue({
      id: 'member-row',
      squadId: 'squad-1',
      userId: 'member-1',
      role: SquadRole.MEMBER,
      rosterType: SquadRosterType.SUBSTITUTE,
    });
    prisma.tx.squadMember.count.mockResolvedValue(4);

    await expect(
      service.updateMemberRole('leader-1', 'squad-1', 'member-1', {
        roster_type: SquadRosterType.MAIN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tx.squadMember.update).not.toHaveBeenCalled();
  });

  it('rejecting an invitation removes the player from the persistent squad and notifies its leader', async () => {
    prisma.tournamentInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      squadId: 'squad-1',
      tournamentId: 'tournament-1',
      teamId: 'team-1',
      leaderId: 'leader-1',
      inviteeUserId: 'member-1',
      status: TournamentInvitationStatus.PENDING,
      invitee: { id: 'member-1', name: 'Player', isActive: true },
      leader: { id: 'leader-1' },
      tournament: {
        id: 'tournament-1',
        title: 'Arena Cup',
        status: TournamentStatus.LIVE,
        registrationClosesAt: new Date(Date.now() + 60_000),
      },
      squad: { id: 'squad-1' },
    });

    await expect(service.respondToInvitation('member-1', 'invite-1', 'REJECT')).resolves.toMatchObject({
      status: TournamentInvitationStatus.REJECTED,
      team_id: 'team-1',
    });
    expect(prisma.tx.tournamentInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        squadId: 'squad-1',
        inviteeUserId: 'member-1',
        status: TournamentInvitationStatus.PENDING,
      },
      data: { status: TournamentInvitationStatus.REJECTED },
    });
    expect(prisma.tx.squadMember.deleteMany).toHaveBeenCalledWith({
      where: { squadId: 'squad-1', userId: 'member-1' },
    });
    expect(events.emit).toHaveBeenCalledWith(
      'squad.invitation.responded',
      expect.objectContaining({ userId: 'leader-1', action: 'REJECT' }),
    );
  });

  it('does not let a different user respond to an invitation', async () => {
    prisma.tournamentInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      inviteeUserId: 'member-1',
    });

    await expect(
      service.respondToInvitation('other-user', 'invite-1', 'ACCEPT'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts an invitation only while the player remains in the persistent squad', async () => {
    prisma.tournamentInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      squadId: 'squad-1',
      tournamentId: 'tournament-1',
      teamId: 'team-1',
      leaderId: 'leader-1',
      inviteeUserId: 'member-1',
      status: TournamentInvitationStatus.PENDING,
      invitee: { id: 'member-1', name: 'Player', isActive: true },
      leader: { id: 'leader-1' },
      tournament: {
        id: 'tournament-1',
        title: 'Arena Cup',
        status: TournamentStatus.LIVE,
      },
      squad: { id: 'squad-1' },
    });
    prisma.tx.squadMember.findUnique.mockResolvedValue(null);

    await expect(
      service.respondToInvitation('member-1', 'invite-1', 'ACCEPT'),
    ).rejects.toThrow('Invitation is no longer valid because you are not in this squad');
    expect(prisma.tx.teamMember.create).not.toHaveBeenCalled();
    expect(prisma.tx.tournamentInvitation.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { status: TournamentInvitationStatus.REJECTED },
    });
  });

  it('dispatches 4 invitations for a Manager squad owner and 3 invitations for a Leader squad owner', async () => {
    prisma.squad.findUnique.mockResolvedValue({
      id: 'squad-mgr',
      gameId: 'game-1',
      name: 'Manager Squad',
      tag: 'MS',
      logoUrl: null,
      leaderId: 'mgr-1',
      ownerRole: 'MANAGER',
      maxMainPlayers: 4,
      maxSubstitutes: 2,
      game: { id: 'game-1', slug: 'free_fire', name: 'Free Fire' },
      members: [
        { userId: 'mgr-1', role: 'MANAGER', rosterType: 'MAIN', user: { id: 'mgr-1', name: 'Manager Apex', isActive: true } },
        { userId: 'p-1', role: 'MEMBER', rosterType: 'MAIN', user: { id: 'p-1', name: 'Player 1', isActive: true } },
        { userId: 'p-2', role: 'MEMBER', rosterType: 'MAIN', user: { id: 'p-2', name: 'Player 2', isActive: true } },
        { userId: 'p-3', role: 'MEMBER', rosterType: 'MAIN', user: { id: 'p-3', name: 'Player 3', isActive: true } },
        { userId: 'p-4', role: 'MEMBER', rosterType: 'MAIN', user: { id: 'p-4', name: 'Player 4', isActive: true } },
      ],
    });
    prisma.tournament.findUnique.mockResolvedValue({
      id: 'tourney-1',
      title: 'Arena Cup',
      gameId: 'game-1',
      status: TournamentStatus.LIVE,
    });
    prisma.gameProfile.count.mockResolvedValue(4);
    prisma.tournamentRegistration.findFirst.mockResolvedValue(null);
    prisma.teamMember.findFirst.mockResolvedValue(null);
    prisma.team.findUnique.mockResolvedValue(null);
    prisma.team.upsert.mockResolvedValue({ id: 'team-mgr-1' });
    prisma.tournamentInvitation.createMany = jest.fn().mockResolvedValue({ count: 4 });
    prisma.tournamentInvitation.findMany.mockResolvedValue([
      { id: 'inv-1', squadId: 'squad-mgr', tournamentId: 'tourney-1', teamId: 'team-mgr-1', leaderId: 'mgr-1', inviteeUserId: 'p-1', status: 'PENDING', createdAt: new Date(), invitee: { id: 'p-1', name: 'Player 1' } },
      { id: 'inv-2', squadId: 'squad-mgr', tournamentId: 'tourney-1', teamId: 'team-mgr-1', leaderId: 'mgr-1', inviteeUserId: 'p-2', status: 'PENDING', createdAt: new Date(), invitee: { id: 'p-2', name: 'Player 2' } },
      { id: 'inv-3', squadId: 'squad-mgr', tournamentId: 'tourney-1', teamId: 'team-mgr-1', leaderId: 'mgr-1', inviteeUserId: 'p-3', status: 'PENDING', createdAt: new Date(), invitee: { id: 'p-3', name: 'Player 3' } },
      { id: 'inv-4', squadId: 'squad-mgr', tournamentId: 'tourney-1', teamId: 'team-mgr-1', leaderId: 'mgr-1', inviteeUserId: 'p-4', status: 'PENDING', createdAt: new Date(), invitee: { id: 'p-4', name: 'Player 4' } },
    ]);

    const res = await service.inviteSquadToTournament('mgr-1', 'squad-mgr', 'tourney-1');

    expect(prisma.team.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ownerRole: 'MANAGER',
          members: { create: { userId: 'mgr-1', role: 'MANAGER' } },
        }),
      }),
    );
    expect(prisma.tournamentInvitation.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ inviteeUserId: 'p-1' }),
        expect.objectContaining({ inviteeUserId: 'p-2' }),
        expect.objectContaining({ inviteeUserId: 'p-3' }),
        expect.objectContaining({ inviteeUserId: 'p-4' }),
      ]),
      skipDuplicates: true,
    });
    expect(res.invitations.length).toBe(4);
  });
});
