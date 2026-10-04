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
      },
      tournamentInvitation: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      tournamentRegistration: { findFirst: jest.fn() },
      teamMember: { findFirst: jest.fn() },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      tx,
    };
    events = { emit: jest.fn() };
    service = new SquadsService(prisma as PrismaService, events as unknown as EventEmitter2);
  });

  it('returns an explicit empty squad for a user without squad membership', async () => {
    prisma.squadMember.findUnique.mockResolvedValue(null);

    await expect(service.getMySquad('user-1')).resolves.toEqual({ squad: null });
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
});
