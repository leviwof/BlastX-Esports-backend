import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  RegistrationStatus,
  SquadRole,
  SquadRosterType,
  TeamMemberRole,
  TournamentInvitationStatus,
  TournamentStatus,
  OwnerRole,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSquadDto } from './dto/create-squad.dto';
import { JoinSquadDto } from './dto/join-squad.dto';
import { SwapSquadMembersDto } from './dto/swap-squad-members.dto';
import { TransferSquadLeaderDto } from './dto/transfer-squad-leader.dto';
import { UpdateSquadMemberRoleDto } from './dto/update-squad-member-role.dto';

const squadInclude = {
  leader: { select: { id: true, name: true, isActive: true } },
  game: { select: { id: true, slug: true, name: true } },
  members: {
    orderBy: [{ rosterType: 'asc' as const }, { joinedAt: 'asc' as const }],
    include: {
      user: {
        select: {
          id: true,
          name: true,
          isActive: true,
          profilePic: true,
          gameProfiles: { select: { gameId: true, inGameName: true, inGameUid: true } },
        },
      },
    },
  },
};

@Injectable()
export class SquadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async getMySquad(userId: string) {
    const membership = await this.prisma.squadMember.findUnique({
      where: { userId },
      select: { squadId: true },
    });
    if (!membership) return { status: 'success', data: { squad: null } };

    const squad = await this.prisma.squad.findUnique({
      where: { id: membership.squadId },
      include: squadInclude,
    });
    return { status: 'success', data: { squad: squad ? this.toSquadResponse(squad) : null } };
  }

  async createSquad(userId: string, dto: CreateSquadDto) {
    const existingMembership = await this.prisma.squadMember.findUnique({
      where: { userId },
    });
    if (existingMembership) {
      if (existingMembership.role === SquadRole.LEADER || existingMembership.role === SquadRole.MANAGER) {
        throw new BadRequestException('User is already a Leader or Manager of another squad');
      }
      throw new BadRequestException('User already belongs to a persistent squad');
    }

    const game = dto.game_slug
      ? await this.prisma.game.findFirst({ where: { slug: dto.game_slug } })
      : await this.prisma.game.findFirst();
    if (!game) throw new BadRequestException('Game not found');

    const ownerRole = dto.owner_role ?? OwnerRole.LEADER;
    const squadRole = ownerRole === OwnerRole.MANAGER ? SquadRole.MANAGER : SquadRole.LEADER;

    const squad = await this.prisma.squad.create({
      data: {
        gameId: game.id,
        name: dto.name.trim(),
        tag: dto.tag?.trim() || '',
        leaderId: userId,
        ownerRole: ownerRole,
        maxMainPlayers: 4,
        maxSubstitutes: 2,
        members: {
          create: {
            userId,
            role: squadRole,
            rosterType: SquadRosterType.MAIN,
          },
        },
      },
      include: squadInclude,
    });

    return {
      status: 'success',
      message: 'Squad created successfully',
      data: {
        squad: this.toSquadResponse(squad),
      },
    };
  }

  async joinSquad(userId: string, dto: JoinSquadDto) {
    const existingMembership = await this.prisma.squadMember.findUnique({
      where: { userId },
    });
    if (existingMembership) {
      throw new BadRequestException('You already belong to a persistent squad');
    }

    const code = dto.squad_code.trim();
    const squad = await this.prisma.squad.findFirst({
      where: {
        OR: [
          { id: code },
          { name: { equals: code, mode: 'insensitive' } },
        ],
      },
      include: squadInclude,
    });
    if (!squad) {
      throw new NotFoundException(`Squad '${dto.squad_code}' not found`);
    }

    const mainCount = squad.members.filter((m) => m.rosterType === SquadRosterType.MAIN).length;
    const subCount = squad.members.filter((m) => m.rosterType === SquadRosterType.SUBSTITUTE).length;

    if (mainCount >= squad.maxMainPlayers && subCount >= squad.maxSubstitutes) {
      throw new BadRequestException('Squad roster is full (4 Main + 2 Substitutes max)');
    }

    const rosterType = mainCount < squad.maxMainPlayers ? SquadRosterType.MAIN : SquadRosterType.SUBSTITUTE;

    await this.prisma.squadMember.create({
      data: {
        squadId: squad.id,
        userId,
        role: SquadRole.MEMBER,
        rosterType,
      },
    });

    const updated = await this.prisma.squad.findUnique({
      where: { id: squad.id },
      include: squadInclude,
    });

    return {
      status: 'success',
      message: 'Joined squad successfully',
      data: {
        squad: updated ? this.toSquadResponse(updated) : null,
      },
    };
  }

  async saveMyRegisteredSquad(userId: string) {
    const current = await this.getMySquad(userId);
    if (current.squad) return current;

    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: {
        userId,
        status: RegistrationStatus.CONFIRMED,
        team: {
          is: {
            captainId: userId,
            tournament: { is: { teamMode: 'SQUAD' } },
          },
        },
      },
      include: {
        team: { include: { members: true } },
        tournament: { select: { gameId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!registration?.team) {
      throw new BadRequestException('Register a full SQUAD team before saving a persistent squad');
    }

    const mainMembers = registration.team.members.filter(
      (member) => member.role !== TeamMemberRole.SUBSTITUTE && member.role !== TeamMemberRole.MANAGER,
    );
    if (mainMembers.length !== 4) {
      throw new BadRequestException('A persistent squad requires exactly four main players');
    }
    if (registration.team.persistentSquadId) {
      return {
        squad: await this.getSquadById(registration.team.persistentSquadId),
      };
    }

    const existingSquad = await this.prisma.squad.findUnique({
      where: {
        gameId_leaderId: {
          gameId: registration.tournament.gameId,
          leaderId: userId,
        },
      },
    });
    if (existingSquad) {
      return { squad: await this.getSquadById(existingSquad.id) };
    }

    const memberIds = registration.team.members.map((member) => member.userId);
    const occupied = await this.prisma.squadMember.findFirst({
      where: { userId: { in: memberIds } },
      select: { userId: true },
    });
    if (occupied) {
      throw new BadRequestException('A registered player already belongs to another persistent squad');
    }

    const squadOwnerRole = registration.team!.ownerRole ?? OwnerRole.LEADER;
    await this.prisma.$transaction(
      async (tx) => {
        const squad = await tx.squad.create({
          data: {
            gameId: registration.tournament.gameId,
            name: registration.team!.name,
            tag: registration.team!.tag,
            logoUrl: registration.team!.logoUrl,
            leaderId: userId,
            ownerRole: squadOwnerRole,
            members: {
              create: registration.team!.members.map((member) => ({
                userId: member.userId,
                role:
                  member.userId === userId
                    ? (squadOwnerRole === OwnerRole.MANAGER ? SquadRole.MANAGER : SquadRole.LEADER)
                    : member.role === TeamMemberRole.MANAGER
                    ? SquadRole.MANAGER
                    : SquadRole.MEMBER,
                rosterType:
                  member.role === TeamMemberRole.SUBSTITUTE
                    ? SquadRosterType.SUBSTITUTE
                    : SquadRosterType.MAIN,
              })),
            },
          },
        });
        await tx.team.update({
          where: { id: registration.team!.id },
          data: { persistentSquadId: squad.id },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return this.getMySquad(userId);
  }

  async removeMember(leaderId: string, squadId: string, userId: string) {
    const squad = await this.requireLeader(leaderId, squadId);
    if (userId === squad.leaderId) {
      throw new BadRequestException({
        code: 'LEADER_MUST_TRANSFER',
        message: 'The squad leader must transfer leadership before leaving the squad',
      });
    }
    const member = await this.prisma.squadMember.findUnique({
      where: { userId },
      select: { id: true, squadId: true },
    });
    if (!member || member.squadId !== squadId) {
      throw new NotFoundException('User is not a member of this squad');
    }

    await this.prisma.$transaction([
      this.prisma.tournamentInvitation.updateMany({
        where: {
          squadId,
          inviteeUserId: userId,
          status: TournamentInvitationStatus.PENDING,
        },
        data: { status: TournamentInvitationStatus.REJECTED },
      }),
      this.prisma.squadMember.delete({ where: { id: member.id } }),
    ]);
    return { message: 'Member removed from squad' };
  }

  async transferLeader(
    leaderId: string,
    squadId: string,
    dto: TransferSquadLeaderDto,
  ) {
    const squad = await this.requireLeader(leaderId, squadId);
    if (dto.new_leader_id === leaderId) {
      throw new BadRequestException('User is already the squad leader');
    }
    const target = await this.prisma.squadMember.findUnique({
      where: { userId: dto.new_leader_id },
    });
    if (!target || target.squadId !== squadId) {
      throw new NotFoundException('New leader must be a member of this squad');
    }

    await this.prisma.$transaction(async (tx) => {
      if (target.rosterType === SquadRosterType.SUBSTITUTE) {
        const mainCount = await tx.squadMember.count({
          where: { squadId, rosterType: SquadRosterType.MAIN },
        });
        if (mainCount >= squad.maxMainPlayers) {
          const substituteCount = await tx.squadMember.count({
            where: { squadId, rosterType: SquadRosterType.SUBSTITUTE },
          });
          if (substituteCount >= squad.maxSubstitutes) {
            throw new BadRequestException('No roster slot is available for the new leader');
          }
          await tx.squadMember.update({
            where: { userId: leaderId },
            data: { rosterType: SquadRosterType.SUBSTITUTE },
          });
        }
        await tx.squadMember.update({
          where: { userId: dto.new_leader_id },
          data: { rosterType: SquadRosterType.MAIN },
        });
      }
      const newOwnerRole = squad.ownerRole === OwnerRole.MANAGER ? SquadRole.MANAGER : SquadRole.LEADER;
      await tx.squadMember.update({
        where: { userId: leaderId },
        data: { role: SquadRole.MEMBER },
      });
      await tx.squadMember.update({
        where: { userId: dto.new_leader_id },
        data: { role: newOwnerRole },
      });
      await tx.squad.update({
        where: { id: squadId },
        data: { leaderId: dto.new_leader_id },
      });
    }, { isolationLevel: 'Serializable' });
    const updated = await this.prisma.squad.findUnique({
      where: { id: squadId },
      include: squadInclude,
    });
    return updated ? this.toSquadResponse(updated) : null;
  }

  async updateMemberRole(
    leaderId: string,
    squadId: string,
    userId: string,
    dto: UpdateSquadMemberRoleDto,
  ) {
    const squad = await this.requireLeader(leaderId, squadId);
    const member = await this.prisma.squadMember.findUnique({ where: { userId } });
    if (!member || member.squadId !== squadId) {
      throw new NotFoundException('User is not a member of this squad');
    }
    if (member.role === SquadRole.LEADER && dto.roster_type !== SquadRosterType.MAIN) {
      throw new BadRequestException('The squad leader must remain in the main roster');
    }

    const capacity =
      dto.roster_type === SquadRosterType.MAIN
        ? squad.maxMainPlayers
        : squad.maxSubstitutes;
    await this.prisma.$transaction(async (tx) => {
      const currentCount = await tx.squadMember.count({
        where: {
          squadId,
          rosterType: dto.roster_type,
          NOT: { userId },
        },
      });
      if (member.rosterType !== dto.roster_type && currentCount >= capacity) {
        throw new BadRequestException(
          dto.roster_type === SquadRosterType.MAIN
            ? 'MAIN_ROSTER_FULL'
            : 'SUBSTITUTE_ROSTER_FULL',
        );
      }

      await tx.squadMember.update({
        where: { userId },
        data: { rosterType: dto.roster_type },
      });
    }, { isolationLevel: 'Serializable' });
    return this.getSquadById(squadId);
  }

  async swapMembers(leaderId: string, squadId: string, dto: SwapSquadMembersDto) {
    await this.requireLeader(leaderId, squadId);
    if (dto.main_user_id === dto.sub_user_id) {
      throw new BadRequestException('Choose two different squad members');
    }
    const [main, substitute] = await Promise.all([
      this.prisma.squadMember.findUnique({ where: { userId: dto.main_user_id } }),
      this.prisma.squadMember.findUnique({ where: { userId: dto.sub_user_id } }),
    ]);
    if (!main || main.squadId !== squadId || main.rosterType !== SquadRosterType.MAIN) {
      throw new BadRequestException('main_user_id must identify a main squad player');
    }
    if (
      main.role === SquadRole.LEADER ||
      !substitute ||
      substitute.squadId !== squadId ||
      substitute.rosterType !== SquadRosterType.SUBSTITUTE
    ) {
      throw new BadRequestException('sub_user_id must identify a substitute member');
    }

    await this.prisma.$transaction([
      this.prisma.squadMember.update({
        where: { userId: main.userId },
        data: { rosterType: SquadRosterType.SUBSTITUTE },
      }),
      this.prisma.squadMember.update({
        where: { userId: substitute.userId },
        data: { rosterType: SquadRosterType.MAIN },
      }),
    ]);
    return this.getSquadById(squadId);
  }

  async inviteSquadToTournament(leaderId: string, squadId: string, tournamentId: string) {
    const squad = await this.prisma.squad.findUnique({
      where: { id: squadId },
      include: {
        ...squadInclude,
        members: {
          where: { rosterType: SquadRosterType.MAIN },
          include: {
            user: { select: { id: true, name: true, isActive: true } },
          },
        },
      },
    });
    if (!squad) throw new NotFoundException('Squad not found');
    if (squad.leaderId !== leaderId) {
      throw new ForbiddenException('Only the squad leader can invite members');
    }
    if (!squad.members.find((member) => member.userId === leaderId)?.user.isActive) {
      throw new ForbiddenException('Inactive squad leaders cannot send tournament invitations');
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        title: true,
        gameId: true,
        status: true,
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.status !== TournamentStatus.LIVE) {
      throw new BadRequestException('Tournament registration is not open');
    }
    if (squad.gameId !== tournament.gameId) {
      throw new BadRequestException('Squad is configured for a different game');
    }
    const squadOwnerRole = squad.ownerRole ?? OwnerRole.LEADER;
    const mainPlayingSquadMembers = squad.members.filter(
      (member) => member.role !== SquadRole.MANAGER,
    );
    if (mainPlayingSquadMembers.length !== squad.maxMainPlayers) {
      throw new BadRequestException(
        `A full main roster of ${squad.maxMainPlayers} players is required to invite a squad`,
      );
    }

    const activeMainMemberIds = mainPlayingSquadMembers
      .filter((member) => member.user.isActive)
      .map((member) => member.userId);
    const profileCount = activeMainMemberIds.length
      ? await this.prisma.gameProfile.count({
          where: { gameId: squad.gameId, userId: { in: activeMainMemberIds } },
        })
      : 0;
    if (profileCount !== activeMainMemberIds.length) {
      throw new BadRequestException('All active squad players need a game profile before they can be invited');
    }

    const otherMembers =
      squadOwnerRole === OwnerRole.MANAGER
        ? activeMainMemberIds
        : activeMainMemberIds.filter((id) => id !== leaderId);

    const expectedInviteCount = squadOwnerRole === OwnerRole.MANAGER ? 4 : 3;
    if (otherMembers.length !== expectedInviteCount) {
      throw new BadRequestException(
        `${expectedInviteCount} active main players are required to send tournament invitations`,
      );
    }

    const [existingRegistration, existingTeamMember] = await Promise.all([
      this.prisma.tournamentRegistration.findFirst({
        where: {
          tournamentId,
          status: RegistrationStatus.CONFIRMED,
          userId: { in: otherMembers },
        },
        select: { userId: true },
      }),
      this.prisma.teamMember.findFirst({
        where: {
          userId: { in: otherMembers },
          team: { tournamentId },
        },
        select: { userId: true },
      }),
    ]);
    if (existingRegistration || existingTeamMember) {
      throw new BadRequestException({
        code: 'ALREADY_IN_TOURNAMENT',
        message: 'One or more invited squad members already belong to a team in this tournament',
      });
    }

    let inviteCode = randomBytes(4).toString('hex').toUpperCase();
    while (await this.prisma.team.findUnique({ where: { inviteCode } })) {
      inviteCode = randomBytes(4).toString('hex').toUpperCase();
    }
    const initialTeamRole =
      squadOwnerRole === OwnerRole.MANAGER ? TeamMemberRole.MANAGER : TeamMemberRole.CAPTAIN;
    const team = await this.prisma.team.upsert({
      where: {
        unique_tournament_persistent_squad: { tournamentId, persistentSquadId: squadId },
      },
      update: {},
      create: {
        gameId: squad.gameId,
        tournamentId,
        persistentSquadId: squadId,
        name: squad.name,
        tag: squad.tag,
        logoUrl: squad.logoUrl,
        captainId: leaderId,
        ownerRole: squadOwnerRole,
        inviteCode,
        acceptingSubstitutes: true,
        members: { create: { userId: leaderId, role: initialTeamRole } },
      },
      select: { id: true },
    });
    const createdInvitations = await this.prisma.tournamentInvitation.createMany({
      data: otherMembers.map((inviteeUserId) => ({
        squadId,
        tournamentId,
        teamId: team.id,
        leaderId,
        inviteeUserId,
      })),
      skipDuplicates: true,
    });

    const invitations = await this.prisma.tournamentInvitation.findMany({
      where: { squadId, tournamentId, teamId: team.id },
      include: { invitee: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const leader = squad.members.find((member) => member.userId === leaderId)?.user;
    for (const invitation of createdInvitations.count > 0
      ? invitations.filter((item) => item.status === TournamentInvitationStatus.PENDING)
      : []) {
      this.events.emit('squad.invitation.received', {
        invitationId: invitation.id,
        userId: invitation.inviteeUserId,
        leaderName: leader?.name ?? 'Squad leader',
        squadName: squad.name,
        tournamentId,
        tournamentTitle: tournament.title,
      });
    }
    return { team_id: team.id, invitations: invitations.map((item) => this.toInvitationResponse(item)) };
  }

  async getPendingInvitations(userId: string) {
    const invitations = await this.prisma.tournamentInvitation.findMany({
      where: {
        inviteeUserId: userId,
        status: TournamentInvitationStatus.PENDING,
        tournament: { status: TournamentStatus.LIVE },
        invitee: { isActive: true },
      },
      include: {
        squad: { select: { id: true, name: true, tag: true, logoUrl: true } },
        leader: { select: { id: true, name: true } },
        tournament: { select: { id: true, title: true, startsAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      squad_id: invitation.squadId,
      tournament_id: invitation.tournamentId,
      team_id: invitation.teamId,
      status: invitation.status,
      created_at: invitation.createdAt,
      squad: {
        id: invitation.squad.id,
        name: invitation.squad.name,
        tag: invitation.squad.tag,
        logo_url: invitation.squad.logoUrl,
      },
      leader: invitation.leader,
      tournament: {
        id: invitation.tournament.id,
        title: invitation.tournament.title,
        starts_at: invitation.tournament.startsAt,
      },
    }));
  }

  async respondToInvitation(userId: string, invitationId: string, action: 'ACCEPT' | 'REJECT') {
    const invitation = await this.prisma.tournamentInvitation.findUnique({
      where: { id: invitationId },
      include: {
        invitee: { select: { id: true, name: true, isActive: true } },
        leader: { select: { id: true } },
        tournament: { select: { id: true, title: true, status: true } },
        squad: { select: { id: true } },
      },
    });
    if (!invitation) throw new NotFoundException('Tournament invitation not found');
    if (invitation.inviteeUserId !== userId) {
      throw new ForbiddenException('This invitation belongs to another user');
    }
    if (invitation.status !== TournamentInvitationStatus.PENDING) {
      throw new BadRequestException(`Invitation is already ${invitation.status.toLowerCase()}`);
    }
    if (!invitation.invitee.isActive) {
      throw new ForbiddenException('Inactive users cannot respond to tournament invitations');
    }
    if (invitation.tournament.status !== TournamentStatus.LIVE) {
      await this.prisma.tournamentInvitation.update({
        where: { id: invitationId },
        data: { status: TournamentInvitationStatus.EXPIRED },
      });
      throw new BadRequestException('Tournament invitation has expired');
    }

    if (action === 'ACCEPT') {
      const accepted = await this.prisma.$transaction(
        async (tx) => {
          const membership = await tx.squadMember.findUnique({ where: { userId } });
          if (!membership || membership.squadId !== invitation.squadId) {
            await tx.tournamentInvitation.update({
              where: { id: invitationId },
              data: { status: TournamentInvitationStatus.REJECTED },
            });
            return false;
          }

          const conflictingRegistration = await tx.tournamentRegistration.findFirst({
            where: {
              tournamentId: invitation.tournamentId,
              userId,
              status: RegistrationStatus.CONFIRMED,
            },
            select: { id: true },
          });
          const conflictingTeam = await tx.teamMember.findFirst({
            where: {
              userId,
              team: { tournamentId: invitation.tournamentId, id: { not: invitation.teamId } },
            },
            select: { id: true },
          });
          if (conflictingRegistration || conflictingTeam) {
            throw new BadRequestException({
              code: 'ALREADY_IN_TOURNAMENT',
              message: 'You already belong to a different team in this tournament',
            });
          }

          await tx.teamMember.create({
            data: { teamId: invitation.teamId, userId, role: TeamMemberRole.PLAYER },
          });
          await tx.tournamentInvitation.update({
            where: { id: invitationId },
            data: { status: TournamentInvitationStatus.ACCEPTED },
          });
          return true;
        },
        { isolationLevel: 'Serializable' },
      );
      if (!accepted) {
        throw new BadRequestException('Invitation is no longer valid because you are not in this squad');
      }
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.tournamentInvitation.updateMany({
          where: {
            squadId: invitation.squadId,
            inviteeUserId: userId,
            status: TournamentInvitationStatus.PENDING,
          },
          data: { status: TournamentInvitationStatus.REJECTED },
        });
        await tx.squadMember.deleteMany({
          where: { squadId: invitation.squadId, userId },
        });
      });
    }

    this.events.emit('squad.invitation.responded', {
      userId: invitation.leaderId,
      playerName: invitation.invitee.name,
      squadId: invitation.squadId,
      tournamentId: invitation.tournamentId,
      tournamentTitle: invitation.tournament.title,
      action,
    });
    return {
      id: invitation.id,
      status:
        action === 'ACCEPT'
          ? TournamentInvitationStatus.ACCEPTED
          : TournamentInvitationStatus.REJECTED,
      team_id: invitation.teamId,
      tournament_id: invitation.tournamentId,
    };
  }

  async expireTournamentInvitations(tournamentId: string) {
    const result = await this.prisma.tournamentInvitation.updateMany({
      where: {
        tournamentId,
        status: TournamentInvitationStatus.PENDING,
      },
      data: { status: TournamentInvitationStatus.EXPIRED },
    });
    return result.count;
  }

  private async getSquadById(squadId: string) {
    const squad = await this.prisma.squad.findUnique({
      where: { id: squadId },
      include: squadInclude,
    });
    if (!squad) throw new NotFoundException('Squad not found');
    return this.toSquadResponse(squad);
  }

  private async requireLeader(userId: string, squadId: string) {
    const squad = await this.prisma.squad.findUnique({ where: { id: squadId } });
    if (!squad) throw new NotFoundException('Squad not found');
    if (squad.leaderId !== userId) {
      throw new ForbiddenException('Only the squad leader can manage this squad');
    }
    return squad;
  }

  private toSquadResponse(squad: {
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
    leaderId: string;
    ownerRole?: OwnerRole;
    maxMainPlayers: number;
    maxSubstitutes: number;
    game: { id: string; slug: string; name: string };
    members: Array<{
      userId: string;
      role: SquadRole;
      rosterType: SquadRosterType;
      joinedAt: Date;
      user: {
        id: string;
        name: string;
        profilePic: string | null;
        gameProfiles: Array<{ gameId: string; inGameName: string; inGameUid: string }>;
      };
    }>;
  }) {
    return {
      id: squad.id,
      name: squad.name,
      tag: squad.tag,
      logo_url: squad.logoUrl,
      leader_id: squad.leaderId,
      owner_role: squad.ownerRole ?? OwnerRole.LEADER,
      game_slug: squad.game.slug,
      max_main_players: squad.maxMainPlayers,
      max_substitutes: squad.maxSubstitutes,
      members: squad.members.map((member) => {
        const profile = member.user.gameProfiles.find(
          (gameProfile) => gameProfile.gameId === squad.game.id,
        );
        return {
          user_id: member.userId,
          name: member.user.name,
          role: member.role,
          roster_type: member.rosterType,
          joined_at: member.joinedAt,
          user: {
            id: member.user.id,
            name: member.user.name,
            profile_pic: member.user.profilePic,
            game_profile: profile
              ? { in_game_name: profile.inGameName, in_game_uid: profile.inGameUid }
              : null,
          },
        };
      }),
    };
  }

  private toInvitationResponse<T extends {
    id: string;
    inviteeUserId: string;
    status: TournamentInvitationStatus;
    createdAt: Date;
    invitee: { id: string; name: string };
  }>(invitation: T) {
    return {
      id: invitation.id,
      invitee_user_id: invitation.inviteeUserId,
      invitee_name: invitation.invitee.name,
      status: invitation.status,
      created_at: invitation.createdAt,
    };
  }
}
