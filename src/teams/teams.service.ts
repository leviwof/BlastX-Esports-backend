import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JoinTeamDto } from './dto/join-team.dto';
import { TeamMemberRole, Team, TeamMember, User } from '@prisma/client';
import { randomBytes } from 'crypto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  private generateInviteCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  async createTeam(captainId: string, dto: CreateTeamDto): Promise<Team & { members: (TeamMember & { user: User })[] }> {
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

    return this.prisma.team.create({
      data: {
        gameId: game.id,
        name: dto.name,
        tag: dto.tag.toUpperCase(),
        logoUrl: dto.logo_url,
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
          include: { user: true },
        },
      },
    });
  }

  async getTeamsForUser(userId: string): Promise<(Team & { members: (TeamMember & { user: User })[] })[]> {
    return this.prisma.team.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        members: {
          include: { user: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTeamById(teamId: string): Promise<Team & { members: (TeamMember & { user: User })[] }> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: { user: true },
        },
      },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  async joinTeam(userId: string, dto: JoinTeamDto): Promise<Team & { members: (TeamMember & { user: User })[] }> {
    const team = await this.prisma.team.findUnique({
      where: { inviteCode: dto.invite_code },
      include: { members: true },
    });
    if (!team) {
      throw new NotFoundException('Invalid team invite code');
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

    // Check roster limit (max 5)
    if (team.members.length >= 5) {
      throw new BadRequestException('Team roster is full (maximum 5 members allowed)');
    }

    await this.prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId,
        role: TeamMemberRole.PLAYER,
      },
    });

    return this.getTeamById(team.id);
  }

  async removeMemberOrLeave(currentUserId: string, teamId: string, targetUserId: string): Promise<{ message: string }> {
    const team = await this.getTeamById(teamId);
    const targetMember = team.members.find((m) => m.userId === targetUserId);
    if (!targetMember) {
      throw new NotFoundException('Target user is not a member of this team');
    }

    const isCaptain = team.captainId === currentUserId;
    const isSelf = currentUserId === targetUserId;

    if (!isCaptain && !isSelf) {
      throw new ForbiddenException('Only the team captain or the member themselves can perform this action');
    }

    if (targetUserId === team.captainId) {
      throw new BadRequestException('A captain cannot leave without transferring captaincy or disbanding the team');
    }

    await this.prisma.teamMember.delete({
      where: {
        unique_team_user: {
          teamId,
          userId: targetUserId,
        },
      },
    });

    return { message: isSelf ? 'Successfully left the team' : 'Member removed from team' };
  }

  async regenerateInviteCode(captainId: string, teamId: string): Promise<Team & { members: (TeamMember & { user: User })[] }> {
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

  async updateTeam(captainId: string, teamId: string, dto: UpdateTeamDto): Promise<Team & { members: (TeamMember & { user: User })[] }> {
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
