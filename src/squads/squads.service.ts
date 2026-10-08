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
    let membership = await this.prisma.squadMember.findUnique({
      where: { userId },
      select: { squadId: true },
    });

    if (!membership && this.prisma.teamMember?.findFirst) {
      const teamMember = await this.prisma.teamMember.findFirst({
        where: { userId },
        include: {
          team: true,
        },
        orderBy: { joinedAt: 'desc' },
      });

      if (teamMember?.teamId) {
        await this.syncTeamToSquad(teamMember.teamId);
        membership = await this.prisma.squadMember.findUnique({
          where: { userId },
          select: { squadId: true },
        });
      }
    }

    if (!membership) return { status: 'success', squad: null };

    const squad = await this.prisma.squad.findUnique({
      where: { id: membership.squadId },
      include: squadInclude,
    });
    return { status: 'success', squad: squad ? this.toSquadResponse(squad) : null };
  }

  async syncTeamToSquad(teamId: string): Promise<void> {
    if (!this.prisma.team?.findUnique) return;

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true },
    });
    if (!team) return;

    let squadId = team.persistentSquadId;

    if (!squadId) {
      let squad = await this.prisma.squad.findFirst({
        where: {
          gameId: team.gameId,
          leaderId: team.captainId,
        },
      });

      if (!squad) {
        const squadOwnerRole = team.ownerRole ?? OwnerRole.LEADER;
        try {
          squad = await this.prisma.squad.create({
            data: {
              gameId: team.gameId,
              name: team.name,
              tag: team.tag,
              logoUrl: team.logoUrl,
              leaderId: team.captainId,
              ownerRole: squadOwnerRole,
              maxMainPlayers: 4,
              maxSubstitutes: 2,
            },
          });
        } catch {
          // If created concurrently or unique constraint failed, fetch existing squad
          squad = await this.prisma.squad.findFirst({
            where: {
              gameId: team.gameId,
              leaderId: team.captainId,
            },
          });
        }
      }

      if (squad) {
        squadId = squad.id;

        await this.prisma.team.update({
          where: { id: team.id },
          data: { persistentSquadId: squadId },
        });
      }
    }

    if (!squadId) return;

    const squad = await this.prisma.squad.findUnique({
      where: { id: squadId },
      include: { members: true },
    });

    if (!squad) return;

    for (const member of team.members) {
      const existingSquadMember = await this.prisma.squadMember.findUnique({
        where: { userId: member.userId },
      });

      if (!existingSquadMember) {
        const role =
          member.userId === team.captainId
            ? (team.ownerRole === OwnerRole.MANAGER ? SquadRole.MANAGER : SquadRole.LEADER)
            : member.role === TeamMemberRole.MANAGER
            ? SquadRole.MANAGER
            : SquadRole.MEMBER;

        const rosterType =
          member.role === TeamMemberRole.SUBSTITUTE
            ? SquadRosterType.SUBSTITUTE
            : SquadRosterType.MAIN;

        try {
          await this.prisma.squadMember.create({
            data: {
              squadId,
              userId: member.userId,
              role,
              rosterType,
            },
          });
        } catch {
          // Ignore unique constraint error if already inserted concurrently
        }
      }
    }
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

    let squad: any;
    try {
      squad = await this.prisma.squad.create({
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
    } catch {
      throw new BadRequestException('User already owns or belongs to a persistent squad for this game.');
    }

    return {
      status: 'success',
      squad: this.toSquadResponse(squad),
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

    const players = squad.members.filter((member) => member.role !== SquadRole.MANAGER);
    const mainCount = players.filter((member) => member.rosterType === SquadRosterType.MAIN).length;
    const subCount = players.filter((member) => member.rosterType === SquadRosterType.SUBSTITUTE).length;

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
    await this.syncLiveWaitlistStatus(squad.id);

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
        status: 'success',
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
      return { status: 'success', squad: await this.getSquadById(existingSquad.id) };
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
    const squad = await this.requireManagementRole(leaderId, squadId);
    if (userId === squad.leaderId || userId === leaderId) {
      throw new BadRequestException({
        code: 'LEADER_MUST_TRANSFER',
        message: 'The squad leader must transfer leadership before leaving the squad',
      });
    }
    const member = await this.prisma.squadMember.findUnique({
      where: { userId },
      select: { id: true, squadId: true, role: true },
    });
    if (!member || member.squadId !== squadId) {
      throw new NotFoundException('User is not a member of this squad');
    }
    if (member.role === SquadRole.MANAGER || member.role === SquadRole.LEADER) {
      throw new BadRequestException('Managers and leaders cannot be removed as players');
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
    await this.syncLiveWaitlistStatus(squadId);
    return {
      status: 'success',
      message: 'Member removed from squad.',
      squad: await this.getSquadById(squadId),
    };
  }

  async leaveSquad(userId: string, squadId: string) {
    const member = await this.prisma.squadMember.findUnique({
      where: { userId },
      select: { id: true, squadId: true, role: true },
    });
    if (!member || member.squadId !== squadId) {
      throw new NotFoundException('User is not a member of this squad');
    }
    if (member.role !== SquadRole.MEMBER) {
      throw new BadRequestException(
        'Leader or Manager cannot leave team. Transfer ownership first.',
      );
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
    await this.syncLiveWaitlistStatus(squadId);

    return {
      status: 'success',
      message: 'You have left the squad successfully.',
    };
  }

  async transferLeader(
    leaderId: string,
    squadId: string,
    dto: TransferSquadLeaderDto,
  ) {
    const squad = await this.requireManagementRole(leaderId, squadId);
    if (dto.new_leader_id === squad.leaderId) {
      throw new BadRequestException('User is already the squad leader');
    }
    const target = await this.prisma.squadMember.findUnique({
      where: { userId: dto.new_leader_id },
    });
    if (!target || target.squadId !== squadId) {
      throw new NotFoundException('New leader must be a member of this squad');
    }

    const newOwnerRole =
      squad.ownerRole === OwnerRole.MANAGER ? SquadRole.MANAGER : SquadRole.LEADER;
    await this.prisma.$transaction(async (tx) => {
      const previousOwner = await tx.squadMember.findUnique({
        where: { userId: squad.leaderId },
      });
      if (!previousOwner) {
        throw new NotFoundException('Current squad owner is not a member of this squad');
      }

      if (
        newOwnerRole === SquadRole.LEADER &&
        (target.role === SquadRole.MANAGER || target.rosterType === SquadRosterType.SUBSTITUTE)
      ) {
        const mainCount = await tx.squadMember.count({
          where: {
            squadId,
            rosterType: SquadRosterType.MAIN,
            role: { not: SquadRole.MANAGER },
          },
        });
        if (mainCount >= squad.maxMainPlayers) {
          const substituteCount = await tx.squadMember.count({
            where: {
              squadId,
              rosterType: SquadRosterType.SUBSTITUTE,
              role: { not: SquadRole.MANAGER },
            },
          });
          if (substituteCount >= squad.maxSubstitutes) {
            throw new BadRequestException('No roster slot is available for the new leader');
          }
          await tx.squadMember.update({
            where: { userId: squad.leaderId },
            data: { rosterType: SquadRosterType.SUBSTITUTE },
          });
        }
        await tx.squadMember.update({
          where: { userId: dto.new_leader_id },
          data: { rosterType: SquadRosterType.MAIN },
        });
      } else if (newOwnerRole === SquadRole.MANAGER && previousOwner.role === SquadRole.MANAGER) {
        const mainCount = await tx.squadMember.count({
          where: {
            squadId,
            rosterType: SquadRosterType.MAIN,
            role: { not: SquadRole.MANAGER },
            NOT: { userId: dto.new_leader_id },
          },
        });
        const substituteCount = await tx.squadMember.count({
          where: {
            squadId,
            rosterType: SquadRosterType.SUBSTITUTE,
            role: { not: SquadRole.MANAGER },
            NOT: { userId: dto.new_leader_id },
          },
        });
        const countAtOwnerSlot =
          previousOwner.rosterType === SquadRosterType.MAIN ? mainCount : substituteCount;
        const capacityAtOwnerSlot =
          previousOwner.rosterType === SquadRosterType.MAIN
            ? squad.maxMainPlayers
            : squad.maxSubstitutes;
        if (countAtOwnerSlot >= capacityAtOwnerSlot) {
          const otherRosterType =
            previousOwner.rosterType === SquadRosterType.MAIN
              ? SquadRosterType.SUBSTITUTE
              : SquadRosterType.MAIN;
          const countAtOtherSlot =
            previousOwner.rosterType === SquadRosterType.MAIN ? substituteCount : mainCount;
          const capacityAtOtherSlot =
            otherRosterType === SquadRosterType.MAIN
              ? squad.maxMainPlayers
              : squad.maxSubstitutes;
          if (countAtOtherSlot >= capacityAtOtherSlot) {
            throw new BadRequestException('No roster slot is available for the former squad manager');
          }
          await tx.squadMember.update({
            where: { userId: squad.leaderId },
            data: { rosterType: otherRosterType },
          });
        }
      }
      await tx.squadMember.update({
        where: { userId: squad.leaderId },
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
    await this.syncLiveWaitlistStatus(squadId);
    const updated = await this.prisma.squad.findUnique({
      where: { id: squadId },
      include: squadInclude,
    });
    return {
      status: 'success',
      message: 'Leadership transferred successfully.',
      squad: updated ? this.toSquadResponse(updated) : null,
    };
  }

  async updateMemberRole(
    leaderId: string,
    squadId: string,
    userId: string,
    dto: UpdateSquadMemberRoleDto,
  ) {
    const squad = await this.requireManagementRole(leaderId, squadId);
    if (dto.roster_type === undefined && dto.role === undefined) {
      throw new BadRequestException('At least one of role or roster_type is required');
    }
    const member = await this.prisma.squadMember.findUnique({ where: { userId } });
    if (!member || member.squadId !== squadId) {
      throw new NotFoundException('User is not a member of this squad');
    }
    if (member.role === SquadRole.LEADER && dto.role !== undefined) {
      throw new BadRequestException('Transfer leadership before changing the leader role');
    }
    if (member.userId === squad.leaderId && dto.role !== undefined) {
      throw new BadRequestException('Transfer ownership before changing the owner role');
    }
    if (dto.role === SquadRole.LEADER) {
      throw new BadRequestException('Use the transfer-leader endpoint to transfer leadership');
    }
    if (
      member.role === SquadRole.LEADER &&
      dto.roster_type !== undefined &&
      dto.roster_type !== SquadRosterType.MAIN
    ) {
      throw new BadRequestException('The squad leader must remain in the main roster');
    }
    if (member.role === SquadRole.MANAGER && dto.roster_type !== undefined) {
      throw new BadRequestException('Managers do not occupy playing roster slots');
    }

    const nextRosterType = dto.roster_type ?? member.rosterType;
    const nextRole = dto.role ?? member.role;
    const capacity = nextRosterType === SquadRosterType.MAIN ? squad.maxMainPlayers : squad.maxSubstitutes;
    await this.prisma.$transaction(async (tx) => {
      if (
        nextRole !== SquadRole.MANAGER &&
        (nextRosterType !== member.rosterType || member.role === SquadRole.MANAGER)
      ) {
        const currentCount = await tx.squadMember.count({
          where: {
            squadId,
            rosterType: nextRosterType,
            role: { not: SquadRole.MANAGER },
            NOT: { userId },
          },
        });
        if (currentCount >= capacity) {
          throw new BadRequestException(
            nextRosterType === SquadRosterType.MAIN
              ? 'MAIN_ROSTER_FULL'
              : 'SUBSTITUTE_ROSTER_FULL',
          );
        }
      }

      await tx.squadMember.update({
        where: { userId },
        data: {
          ...(dto.roster_type !== undefined ? { rosterType: dto.roster_type } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
        },
      });
    }, { isolationLevel: 'Serializable' });
    await this.syncLiveWaitlistStatus(squadId);
    return {
      status: 'success',
      squad: await this.getSquadById(squadId),
    };
  }

  async swapMembers(leaderId: string, squadId: string, dto: SwapSquadMembersDto) {
    await this.requireManagementRole(leaderId, squadId);
    if (dto.main_user_id === dto.sub_user_id) {
      throw new BadRequestException('Choose two different squad members');
    }
    const [main, substitute] = await Promise.all([
      this.prisma.squadMember.findUnique({ where: { userId: dto.main_user_id } }),
      this.prisma.squadMember.findUnique({ where: { userId: dto.sub_user_id } }),
    ]);
    if (
      !main ||
      main.squadId !== squadId ||
      main.role === SquadRole.MANAGER ||
      main.rosterType !== SquadRosterType.MAIN
    ) {
      throw new BadRequestException('main_user_id must identify a main squad player');
    }
    if (
      main.role === SquadRole.LEADER ||
      !substitute ||
      substitute.squadId !== squadId ||
      substitute.role === SquadRole.MANAGER ||
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
    await this.syncLiveWaitlistStatus(squadId);
    return {
      status: 'success',
      message: 'Roster swapped successfully.',
      squad: await this.getSquadById(squadId),
    };
  }

  async getWaitlistStatus(userId: string, squadId: string) {
    const [squad, membership] = await Promise.all([
      this.prisma.squad.findUnique({
        where: { id: squadId },
        select: {
          id: true,
          maxMainPlayers: true,
          maxSubstitutes: true,
          members: { select: { role: true, rosterType: true } },
        },
      }),
      this.prisma.squadMember.findUnique({
        where: { userId },
        select: { squadId: true },
      }),
    ]);
    if (!squad) throw new NotFoundException('Squad not found');
    if (!membership || membership.squadId !== squadId) {
      throw new ForbiddenException('Only squad members can view waitlist status');
    }

    const linkedTeam = await this.prisma.team.findFirst({
      where: {
        persistentSquadId: squadId,
        tournament: { is: { status: TournamentStatus.LIVE } },
      },
      select: {
        id: true,
        tournamentId: true,
        createdAt: true,
        tournament: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!linkedTeam || !linkedTeam.tournamentId || !linkedTeam.tournament) {
      throw new NotFoundException('No live tournament is associated with this squad');
    }

    const waitlist = await this.prisma.tournamentWaitlist.findUnique({
      where: {
        tournamentId_squadId: {
          tournamentId: linkedTeam.tournamentId,
          squadId,
        },
      },
      select: { positionInQueue: true },
    });
    if (!waitlist) {
      throw new NotFoundException('Waitlist status is not available for this squad and tournament');
    }
    const members = squad.members.filter((member) => member.role !== SquadRole.MANAGER);
    const mainPlayersCount = members.filter(
      (member) => member.rosterType === SquadRosterType.MAIN,
    ).length;
    const substitutesCount = members.filter(
      (member) => member.rosterType === SquadRosterType.SUBSTITUTE,
    ).length;

    return {
      status: 'success',
      waitlist: {
        status: mainPlayersCount < squad.maxMainPlayers ? 'WAITLISTED' : 'CONFIRMED',
        tournament_name: linkedTeam.tournament.title,
        position_in_queue: waitlist.positionInQueue,
        main_players_count: mainPlayersCount,
        required_main_players: squad.maxMainPlayers,
        substitutes_count: substitutesCount,
        message:
          mainPlayersCount < squad.maxMainPlayers
            ? `Team is on waitlist. ${squad.maxMainPlayers} main players required to enter match lobby.`
            : 'Team is approved and has a complete main roster.',
      },
    };
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
    const inviter = await this.prisma.squadMember.findUnique({
      where: { userId: leaderId },
      select: {
        squadId: true,
        role: true,
        user: { select: { isActive: true } },
      },
    });
    if (
      !inviter ||
      inviter.squadId !== squadId ||
      (inviter.role !== SquadRole.LEADER && inviter.role !== SquadRole.MANAGER)
    ) {
      throw new ForbiddenException('Only squad leaders and managers can send tournament invitations');
    }
    if (!inviter.user.isActive) {
      throw new ForbiddenException('Inactive squad leaders and managers cannot send tournament invitations');
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
        : activeMainMemberIds.filter((id) => id !== squad.leaderId);

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
        captainId: squad.leaderId,
        ownerRole: squadOwnerRole,
        inviteCode,
        acceptingSubstitutes: true,
        members: { create: { userId: squad.leaderId, role: initialTeamRole } },
      },
      select: { id: true },
    });
    const existingWaitlist = await this.prisma.tournamentWaitlist.findUnique({
      where: {
        tournamentId_squadId: { tournamentId, squadId },
      },
      select: { positionInQueue: true },
    });
    const queueSize = existingWaitlist
      ? 0
      : await this.prisma.tournamentWaitlist.count({
          where: {
            tournamentId,
            status: { not: 'CANCELLED' },
          },
        });
    await this.prisma.tournamentWaitlist.upsert({
      where: {
        tournamentId_squadId: { tournamentId, squadId },
      },
      update: {
        status:
          mainPlayingSquadMembers.length < squad.maxMainPlayers
            ? 'WAITLISTED'
            : 'CONFIRMED',
      },
      create: {
        tournamentId,
        squadId,
        positionInQueue: queueSize + 1,
        status:
          mainPlayingSquadMembers.length < squad.maxMainPlayers
            ? 'WAITLISTED'
            : 'CONFIRMED',
      },
    });
    const createdInvitations = await this.prisma.tournamentInvitation.createMany({
      data: otherMembers.map((inviteeUserId) => ({
        squadId,
        tournamentId,
        teamId: team.id,
        leaderId: squad.leaderId,
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
      tournamentId: invitation.tournamentId,
      tournamentName: invitation.tournament.title,
      squadName: invitation.squad.name,
      leaderName: invitation.leader.name,
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

      let autoRegistered = false;
      const teamMembers = await this.prisma.teamMember.findMany({
        where: { teamId: invitation.teamId },
      });
      const mainCount = teamMembers.filter(
        (m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
      ).length;

      if (mainCount === 4) {
        const existingReg = await this.prisma.tournamentRegistration.findFirst({
          where: {
            tournamentId: invitation.tournamentId,
            teamId: invitation.teamId,
            status: RegistrationStatus.CONFIRMED,
          },
        });
        if (!existingReg) {
          const tourney = await this.prisma.tournament.findUnique({
            where: { id: invitation.tournamentId },
          });
          if (tourney) {
            await this.prisma.tournamentRegistration.create({
              data: {
                tournamentId: invitation.tournamentId,
                userId: invitation.leaderId,
                teamId: invitation.teamId,
                status: RegistrationStatus.CONFIRMED,
                slotNumber: tourney.registeredCount + 1,
              },
            });
            await this.prisma.tournament.update({
              where: { id: invitation.tournamentId },
              data: { registeredCount: { increment: 1 } },
            });
            autoRegistered = true;
          }
        } else {
          autoRegistered = true;
        }
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
        success: true,
        status: 'ACCEPTED',
        auto_registered: autoRegistered,
        id: invitation.id,
        team_id: invitation.teamId,
        tournament_id: invitation.tournamentId,
        team: {
          id: invitation.teamId,
          registration_status: autoRegistered ? 'REGISTERED' : 'FORMING',
        },
      };
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
      await this.syncLiveWaitlistStatus(invitation.squadId);
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
      success: true,
      status: 'REJECTED',
      auto_registered: false,
      id: invitation.id,
      team_id: invitation.teamId,
      tournament_id: invitation.tournamentId,
      team: {
        id: invitation.teamId,
        registration_status: 'FORMING',
      },
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

  private async syncLiveWaitlistStatus(squadId: string) {
    const squad = await this.prisma.squad.findUnique({
      where: { id: squadId },
      select: { maxMainPlayers: true },
    });
    if (!squad) throw new NotFoundException('Squad not found');
    const mainPlayersCount = await this.prisma.squadMember.count({
      where: {
        squadId,
        rosterType: SquadRosterType.MAIN,
        role: { not: SquadRole.MANAGER },
      },
    });
    await this.prisma.tournamentWaitlist.updateMany({
      where: {
        squadId,
        status: { not: 'CANCELLED' },
        tournament: { is: { status: TournamentStatus.LIVE } },
      },
      data: {
        status: mainPlayersCount < squad.maxMainPlayers ? 'WAITLISTED' : 'CONFIRMED',
      },
    });
  }

  private async requireManagementRole(userId: string, squadId: string) {
    const squad = await this.prisma.squad.findUnique({ where: { id: squadId } });
    if (!squad) throw new NotFoundException('Squad not found');
    const membership = await this.prisma.squadMember.findUnique({
      where: { userId },
      select: { squadId: true, role: true },
    });
    if (
      !membership ||
      membership.squadId !== squadId ||
      (membership.role !== SquadRole.LEADER && membership.role !== SquadRole.MANAGER)
    ) {
      throw new ForbiddenException('Only squad leaders and managers can manage this squad');
    }
    return squad;
  }

  private toSquadResponse(squad: {
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
    leaderId: string;
    createdAt: Date;
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
      max_main_players: squad.maxMainPlayers,
      max_substitutes: squad.maxSubstitutes,
      created_at: squad.createdAt,
      members: squad.members.map((member) => {
        const profile = member.user.gameProfiles.find(
          (gameProfile) => gameProfile.gameId === squad.game.id,
        );
        return {
          user_id: member.userId,
          name: member.user.name,
          avatarUrl: member.user.profilePic || '',
          ign: profile?.inGameName ?? null,
          uid: profile?.inGameUid ?? null,
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
