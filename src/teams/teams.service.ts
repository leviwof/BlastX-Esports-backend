import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { ListAdminTeamsQuery } from './dto/list-admin-teams.query';
import {
  TeamSummaryResponse,
  TeamDetailResponse,
  toTeamSummaryResponse,
  toTeamDetailResponse,
} from './team.mapper';
import { PaginatedResult, createPaginatedResponse } from '../common/pagination.dto';
import { Prisma, TeamMemberRole, TeamMode, Team, TeamMember, User, GameProfile, RegistrationStatus, OwnerRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { SquadsService } from '../squads/squads.service';


export type TeamWithMembers = Team & {
  members: (TeamMember & { user: User & { gameProfiles?: GameProfile[] } })[];
};

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly squadsService?: SquadsService,
  ) {}

  private generateInviteCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  async createTeam(captainId: string, dto: CreateTeamDto): Promise<TeamWithMembers> {
    const gameSlug = dto.game_slug || 'free_fire';
    const game = await this.prisma.game.findUnique({ where: { slug: gameSlug } });
    if (!game) {
      throw new BadRequestException(`Game with slug '${gameSlug}' not found`);
    }

    // Must have a Game Profile for this game
    let profile = await this.prisma.gameProfile.findUnique({
      where: {
        unique_user_game: {
          userId: captainId,
          gameId: game.id,
        },
      },
    });

    if (dto.player?.uid || (!profile && (dto.player?.name || dto.player?.ign))) {
      const user = await this.prisma.user.findUnique({
        where: { id: captainId },
        select: { name: true },
      });
      const resolvedUid = dto.player?.uid?.trim() || profile?.inGameUid || '';
      const resolvedIgn =
        dto.player?.ign?.trim() ||
        dto.player?.name?.trim() ||
        profile?.inGameName ||
        user?.name ||
        '';

      if (resolvedUid) {
        profile = await this.prisma.gameProfile.upsert({
          where: { unique_user_game: { userId: captainId, gameId: game.id } },
          update: {
            inGameUid: resolvedUid,
            ...(resolvedIgn ? { inGameName: resolvedIgn } : {}),
          },
          create: {
            userId: captainId,
            gameId: game.id,
            inGameUid: resolvedUid,
            inGameName: resolvedIgn,
          },
        });
      }
    }

    if (!profile) {
      throw new BadRequestException(`You must create a ${game.name} game profile before creating a team`);
    }

    // Case-insensitive team name check for the game
    const existingTeam = await this.prisma.team.findFirst({
      where: {
        gameId: game.id,
        name: { equals: dto.name, mode: 'insensitive' },
      },
    });
    if (existingTeam) {
      throw new BadRequestException(`Team name '${dto.name}' is already taken for this game`);
    }

    let inviteCode = this.generateInviteCode();
    // Ensure uniqueness of invite code
    while (await this.prisma.team.findUnique({ where: { inviteCode } })) {
      inviteCode = this.generateInviteCode();
    }

    const ownerRole = dto.owner_role || dto.ownerRole || OwnerRole.LEADER;
    const initialRole = ownerRole === OwnerRole.MANAGER ? TeamMemberRole.MANAGER : TeamMemberRole.CAPTAIN;

    const team = await this.prisma.team.create({
      data: {
        gameId: game.id,
        name: dto.name,
        tag: dto.tag.toUpperCase(),
        logoUrl: dto.logo_url,
        acceptingSubstitutes: dto.accepting_substitutes ?? true,
        captainId,
        ownerRole,
        inviteCode,
        members: {
          create: {
            userId: captainId,
            role: initialRole,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              include: { gameProfiles: true },
            },
          },
        },
      },
    });

    if (this.squadsService) {
      await this.squadsService.syncTeamToSquad(team.id);
    }

    return team as TeamWithMembers;
  }

  async getTeamsForUser(userId: string): Promise<TeamWithMembers[]> {
    const teams = await this.prisma.team.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        members: {
          include: {
            user: {
              include: { gameProfiles: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return teams as TeamWithMembers[];
  }

  async getTeamById(teamId: string): Promise<TeamWithMembers> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              include: { gameProfiles: true },
            },
          },
        },
      },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team as TeamWithMembers;
  }

  async joinTeam(userId: string, dto: JoinTeamDto, teamId?: string): Promise<TeamWithMembers> {
    let team: (Team & { members: TeamMember[] }) | null = null;

    if (teamId) {
      team = await this.prisma.team.findUnique({
        where: { id: teamId },
        include: { members: true },
      });
      if (!team) {
        throw new NotFoundException('Team not found');
      }
      if (dto.invite_code && dto.invite_code.toUpperCase() !== team.inviteCode.toUpperCase()) {
        throw new BadRequestException('Invalid team invite code');
      }
    } else {
      if (!dto.invite_code) {
        throw new BadRequestException('Invite code is required to join a team');
      }
      team = await this.prisma.team.findFirst({
        where: { inviteCode: { equals: dto.invite_code, mode: 'insensitive' } },
        include: { members: true },
      });
      if (!team) {
        throw new NotFoundException('Invalid team invite code');
      }
    }

    await this.assertRosterUnlocked(team.id);

    // Must have a Game Profile for team's game
    let profile = await this.prisma.gameProfile.findUnique({
      where: {
        unique_user_game: {
          userId,
          gameId: team.gameId,
        },
      },
    });
    if (dto.player?.uid || (!profile && (dto.player?.name || dto.player?.ign))) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const resolvedUid = dto.player?.uid?.trim() || profile?.inGameUid || '';
      const resolvedIgn =
        dto.player?.ign?.trim() ||
        dto.player?.name?.trim() ||
        profile?.inGameName ||
        user?.name ||
        '';

      if (resolvedUid) {
        profile = await this.prisma.gameProfile.upsert({
          where: { unique_user_game: { userId, gameId: team.gameId } },
          update: {
            inGameUid: resolvedUid,
            ...(resolvedIgn ? { inGameName: resolvedIgn } : {}),
          },
          create: {
            userId,
            gameId: team.gameId,
            inGameUid: resolvedUid,
            inGameName: resolvedIgn,
          },
        });
      }
    }
    if (!profile) {
      throw new BadRequestException('You must set up your Free Fire game profile before joining a team');
    }

    // Check if already a member
    const isMember = team.members.some((m) => m.userId === userId);
    if (isMember) {
      throw new BadRequestException('You are already a member of this team');
    }

    if (team.tournamentId) {
      const existingTournamentTeam = await this.prisma.teamMember.findFirst({
        where: {
          userId,
          team: { tournamentId: team.tournamentId },
        },
        select: { teamId: true },
      });
      if (existingTournamentTeam && existingTournamentTeam.teamId !== team.id) {
        throw new BadRequestException({
          success: false,
          status: 'error',
          code: 'ALREADY_IN_TEAM',
          error_code: 'ALREADY_IN_TEAM',
          message: 'You have already joined/registered for this tournament.',
        });
      }
    }

    const tournament = team.tournamentId
      ? await this.prisma.tournament.findUnique({
          where: { id: team.tournamentId },
          select: { teamMode: true },
        })
      : null;
    const maxMainPlayers = tournament?.teamMode === TeamMode.DUO ? 2 : 4;
    const maxRosterSize = maxMainPlayers + (team.acceptingSubstitutes ? 1 : 0);
    if (team.members.length >= maxRosterSize) {
      throw new BadRequestException(`Team roster is full (maximum ${maxRosterSize} members allowed)`);
    }

    // Determine target role (Substitute vs Main Player)
    let isJoiningAsSubstitute =
      dto.as_substitute === true ||
      dto.role === TeamMemberRole.SUBSTITUTE ||
      dto.rosterType?.toUpperCase() === 'SUBSTITUTE';

    const mainPlayers = team.members.filter(
      (m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
    );
    const existingSub = team.members.some((m) => m.role === TeamMemberRole.SUBSTITUTE);

    // If main roster is full, fallback to substitute if team accepts substitutes and has slot
    if (!isJoiningAsSubstitute && mainPlayers.length >= maxMainPlayers) {
      if (team.acceptingSubstitutes && !existingSub) {
        isJoiningAsSubstitute = true;
      }
    }

    let targetRole: TeamMemberRole = TeamMemberRole.PLAYER;
    if (isJoiningAsSubstitute) {
      if (!team.acceptingSubstitutes) {
        throw new BadRequestException('This team is not currently accepting substitutes');
      }
      if (existingSub) {
        throw new BadRequestException('Team already has a substitute player');
      }
      targetRole = TeamMemberRole.SUBSTITUTE;
    } else {
      if (mainPlayers.length >= maxMainPlayers) {
        throw new BadRequestException(
          `Main roster is full (maximum ${maxMainPlayers} players). You can join as a substitute if the team accepts substitutes.`,
        );
      }
    }

    // If team is registered in active tournaments, verify user isn't in another team in those tournaments
    const activeRegistrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        teamId: team.id,
        status: RegistrationStatus.CONFIRMED,
      },
      select: { tournamentId: true },
    });

    if (activeRegistrations.length > 0) {
      const tournamentIds = activeRegistrations.map((r) => r.tournamentId);
      const conflicting = await this.prisma.tournamentRegistration.findFirst({
        where: {
          tournamentId: { in: tournamentIds },
          userId,
          status: RegistrationStatus.CONFIRMED,
          teamId: { not: team.id },
        },
      });
      if (conflicting) {
        throw new BadRequestException(
          'You are already registered with another team in an active tournament this team is participating in',
        );
      }
    }

    try {
      await this.prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId,
          role: targetRole,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('You are already a member of this team');
      }
      throw error;
    }

    if (team.tournamentId) {
      const allMembers = await this.prisma.teamMember.findMany({
        where: { teamId: team.id },
      });
      const mainCount = allMembers.filter(
        (m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
      ).length;

      if (mainCount === 4) {
        const existingReg = await this.prisma.tournamentRegistration.findFirst({
          where: {
            tournamentId: team.tournamentId,
            teamId: team.id,
            status: RegistrationStatus.CONFIRMED,
          },
        });
        if (!existingReg) {
          const tourney = await this.prisma.tournament.findUnique({
            where: { id: team.tournamentId },
          });
          if (tourney) {
            await this.prisma.tournamentRegistration.create({
              data: {
                tournamentId: team.tournamentId,
                userId: team.captainId,
                teamId: team.id,
                status: RegistrationStatus.CONFIRMED,
                slotNumber: tourney.registeredCount + 1,
              },
            });
            await this.prisma.tournament.update({
              where: { id: team.tournamentId },
              data: { registeredCount: { increment: 1 } },
            });
          }
        }
      }
    }

    if (this.squadsService) {
      await this.squadsService.syncTeamToSquad(team.id);
    }

    return this.getTeamById(team.id);
  }

  async leaveTeam(userId: string, teamId: string): Promise<{ message: string }> {
    const team = await this.getTeamById(teamId);
    await this.assertRosterUnlocked(teamId);
    const member = team.members.find((m) => m.userId === userId);
    if (!member) {
      throw new NotFoundException('You are not a member of this team');
    }

    if (team.captainId === userId) {
      throw new BadRequestException('A captain cannot leave without transferring captaincy or disbanding the team');
    }

    await this.prisma.teamMember.delete({
      where: {
        unique_team_user: {
          teamId,
          userId,
        },
      },
    });

    return { message: 'Successfully left the team' };
  }

  async removeMember(captainId: string, teamId: string, targetUserId: string): Promise<{ message: string }> {
    const team = await this.getTeamById(teamId);
    await this.assertRosterUnlocked(teamId);
    if (team.captainId !== captainId) {
      throw new ForbiddenException('Only the team captain can remove members');
    }

    if (targetUserId === captainId) {
      throw new BadRequestException('A captain cannot remove themselves from the team');
    }

    const targetMember = team.members.find((m) => m.userId === targetUserId);
    if (!targetMember) {
      throw new NotFoundException('Target user is not a member of this team');
    }

    await this.prisma.teamMember.delete({
      where: {
        unique_team_user: {
          teamId,
          userId: targetUserId,
        },
      },
    });

    return { message: 'Member removed from team' };
  }

  async removeMemberOrLeave(currentUserId: string, teamId: string, targetUserId: string): Promise<{ message: string }> {
    if (currentUserId === targetUserId) {
      return this.leaveTeam(currentUserId, teamId);
    }
    return this.removeMember(currentUserId, teamId, targetUserId);
  }

  async transferCaptaincy(captainId: string, teamId: string, newCaptainId: string): Promise<TeamWithMembers> {
    const team = await this.getTeamById(teamId);
    await this.assertRosterUnlocked(teamId);
    if (team.captainId !== captainId) {
      throw new ForbiddenException('Only the current team captain can transfer captaincy');
    }

    if (captainId === newCaptainId) {
      throw new BadRequestException('User is already the captain');
    }

    const targetMember = team.members.find((m) => m.userId === newCaptainId);
    if (!targetMember) {
      throw new NotFoundException('Target user is not a member of this team');
    }

    const newRoleForNewOwner =
      team.ownerRole === OwnerRole.MANAGER ? TeamMemberRole.MANAGER : TeamMemberRole.CAPTAIN;

    await this.prisma.$transaction([
      // Downgrade current captain/manager to PLAYER
      this.prisma.teamMember.update({
        where: {
          unique_team_user: {
            teamId,
            userId: captainId,
          },
        },
        data: { role: TeamMemberRole.PLAYER },
      }),
      // Upgrade target member to CAPTAIN or MANAGER
      this.prisma.teamMember.update({
        where: {
          unique_team_user: {
            teamId,
            userId: newCaptainId,
          },
        },
        data: { role: newRoleForNewOwner },
      }),
      // Update team captainId
      this.prisma.team.update({
        where: { id: teamId },
        data: { captainId: newCaptainId },
      }),
    ]);

    return this.getTeamById(teamId);
  }

  async toggleSubstitutes(captainId: string, teamId: string, accepting: boolean): Promise<TeamWithMembers> {
    const team = await this.getTeamById(teamId);
    if (team.captainId !== captainId) {
      throw new ForbiddenException('Only the team captain can change substitute settings');
    }

    await this.prisma.team.update({
      where: { id: teamId },
      data: { acceptingSubstitutes: accepting },
    });

    return this.getTeamById(teamId);
  }

  async regenerateInviteCode(captainId: string, teamId: string): Promise<TeamWithMembers> {
    const team = await this.getTeamById(teamId);
    if (team.captainId !== captainId) {
      throw new ForbiddenException('Only the team captain can regenerate the invite code');
    }

    let newCode = this.generateInviteCode();
    while (await this.prisma.team.findUnique({ where: { inviteCode: newCode } })) {
      newCode = this.generateInviteCode();
    }

    await this.prisma.team.update({
      where: { id: teamId },
      data: { inviteCode: newCode },
    });

    return this.getTeamById(teamId);
  }

  async updateTeam(captainId: string, teamId: string, dto: UpdateTeamDto): Promise<TeamWithMembers> {
    const team = await this.getTeamById(teamId);
    if (team.captainId !== captainId) {
      throw new ForbiddenException('Only the team captain can update team details');
    }

    if (dto.name && dto.name.toLowerCase() !== team.name.toLowerCase()) {
      const existingName = await this.prisma.team.findFirst({
        where: {
          gameId: team.gameId,
          name: { equals: dto.name, mode: 'insensitive' },
          NOT: { id: teamId },
        },
      });
      if (existingName) {
        throw new BadRequestException(`Team name '${dto.name}' is already taken`);
      }
    }

    await this.prisma.team.update({
      where: { id: teamId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.tag ? { tag: dto.tag.toUpperCase() } : {}),
        ...(dto.logo_url !== undefined ? { logoUrl: dto.logo_url } : {}),
      },
    });

    return this.getTeamById(teamId);
  }

  async listAdminTeams(
    query: ListAdminTeamsQuery,
  ): Promise<PaginatedResult<TeamSummaryResponse>> {
    const where: Prisma.TeamWhereInput = {};
    if (query.search && query.search.trim()) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { tag: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.game_slug) {
      where.game = { slug: query.game_slug };
    }

    const [total, teams] = await Promise.all([
      this.prisma.team.count({ where }),
      this.prisma.team.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        include: {
          game: { select: { slug: true } },
          captain: { select: { id: true, name: true } },
          _count: { select: { members: true } },
        },
      }),
    ]);

    return createPaginatedResponse(teams.map(toTeamSummaryResponse), query.page ?? 1, query.limit ?? 20, total);
  }

  async getAdminTeamById(id: string): Promise<TeamDetailResponse> {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        game: { select: { slug: true } },
        captain: { select: { id: true, name: true } },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                gameProfiles: {
                  select: { gameId: true, inGameName: true },
                },
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(`Team with ID '${id}' not found`);
    }

    return toTeamDetailResponse(team);
  }

  private async assertRosterUnlocked(teamId: string): Promise<void> {
    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: { teamId, status: RegistrationStatus.CONFIRMED },
      select: { id: true },
    });
    if (registration) {
      throw new BadRequestException({
        code: 'TEAM_ROSTER_LOCKED',
        message: 'The team roster cannot be changed after tournament registration.',
      });
    }
  }
}
