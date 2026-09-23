import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { TeamMemberRole, Team, TeamMember, User, GameProfile, RegistrationStatus } from '@prisma/client';
import { randomBytes } from 'crypto';

export type TeamWithMembers = Team & {
  members: (TeamMember & { user: User & { gameProfiles?: GameProfile[] } })[];
};

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const profile = await this.prisma.gameProfile.findUnique({
      where: {
        unique_user_game: {
          userId: captainId,
          gameId: game.id,
        },
      },
    });
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

    const team = await this.prisma.team.create({
      data: {
        gameId: game.id,
        name: dto.name,
        tag: dto.tag.toUpperCase(),
        logoUrl: dto.logo_url,
        acceptingSubstitutes: dto.accepting_substitutes ?? true,
        captainId,
        inviteCode,
        members: {
          create: {
            userId: captainId,
            role: TeamMemberRole.CAPTAIN,
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

    // Must have a Game Profile for team's game
    const profile = await this.prisma.gameProfile.findUnique({
      where: {
        unique_user_game: {
          userId,
          gameId: team.gameId,
        },
      },
    });
    if (!profile) {
      throw new BadRequestException('You must set up your Free Fire game profile before joining a team');
    }

    // Check if already a member
    const isMember = team.members.some((m) => m.userId === userId);
    if (isMember) {
      throw new BadRequestException('You are already a member of this team');
    }

    // Check total roster limit (max 5: 4 main + 1 substitute)
    if (team.members.length >= 5) {
      throw new BadRequestException('Team roster is full (maximum 5 members allowed)');
    }

    // Determine target role (Substitute vs Main Player)
    const isJoiningAsSubstitute =
      dto.as_substitute === true || dto.role === TeamMemberRole.SUBSTITUTE;

    let targetRole: TeamMemberRole = TeamMemberRole.PLAYER;
    if (isJoiningAsSubstitute) {
      if (!team.acceptingSubstitutes) {
        throw new BadRequestException('This team is not currently accepting substitutes');
      }
      const existingSub = team.members.some((m) => m.role === TeamMemberRole.SUBSTITUTE);
      if (existingSub) {
        throw new BadRequestException('Team already has a substitute player');
      }
      targetRole = TeamMemberRole.SUBSTITUTE;
    } else {
      const mainPlayers = team.members.filter((m) => m.role !== TeamMemberRole.SUBSTITUTE);
      if (mainPlayers.length >= 4) {
        throw new BadRequestException(
          'Main roster is full (maximum 4 players). You can join as a substitute if the team accepts substitutes.',
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

    await this.prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId,
        role: targetRole,
      },
    });

    return this.getTeamById(team.id);
  }

  async leaveTeam(userId: string, teamId: string): Promise<{ message: string }> {
    const team = await this.getTeamById(teamId);
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

    await this.prisma.$transaction([
      // Downgrade current captain to PLAYER
      this.prisma.teamMember.update({
        where: {
          unique_team_user: {
            teamId,
            userId: captainId,
          },
        },
        data: { role: TeamMemberRole.PLAYER },
      }),
      // Upgrade target member to CAPTAIN
      this.prisma.teamMember.update({
        where: {
          unique_team_user: {
            teamId,
            userId: newCaptainId,
          },
        },
        data: { role: TeamMemberRole.CAPTAIN },
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
}
