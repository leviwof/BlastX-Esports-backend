import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
  toTeamResponse,
  toPrivacySafeTeamPreview,
  PrivacySafeTeamPreviewResponse,
} from './team.mapper';
import { PaginatedResult, createPaginatedResponse } from '../common/pagination.dto';
import {
  Prisma,
  TeamMemberRole,
  TeamMode,
  Team,
  TeamMember,
  User,
  GameProfile,
  RegistrationStatus,
  OwnerRole,
  TeamRegistrationState,
  TeamJoinRequestStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { SquadsService } from '../squads/squads.service';
import { handleRosterChange } from './roster-change.helper';

export type TeamWithMembers = Team & {
  members: (TeamMember & { user: User & { gameProfiles?: GameProfile[] } })[];
  pendingJoinRequestsCount?: number;
};

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly squadsService?: SquadsService,
    @Optional() private readonly events?: EventEmitter2,
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
        _count: {
          select: {
            joinRequests: {
              where: { status: TeamJoinRequestStatus.PENDING },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return teams as unknown as TeamWithMembers[];
  }

  async getTeamById(teamId: string, callerUserId?: string): Promise<TeamWithMembers> {
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
    let pendingJoinRequestsCount: number | undefined = undefined;
    if (callerUserId && team.captainId === callerUserId) {
      pendingJoinRequestsCount = await this.prisma.teamJoinRequest.count({
        where: { teamId, status: TeamJoinRequestStatus.PENDING },
      });
    }
    return {
      ...(team as TeamWithMembers),
      pendingJoinRequestsCount,
    };
  }

  async verifyJoinEligibility(
    userId: string,
    team: Team & { members: TeamMember[] },
    dto: JoinTeamDto,
    tournamentId?: string,
  ): Promise<{
    profile: GameProfile;
    targetRole: TeamMemberRole;
    isJoiningAsSubstitute: boolean;
    maxMainPlayers: number;
  }> {
    if (tournamentId && team.tournamentId && team.tournamentId !== tournamentId) {
      throw new NotFoundException('No team found matching this invite code for this tournament');
    }

    await this.assertRosterUnlocked(team.id);

    // Must have a Game Profile for team's game (upsert if provided in dto.player)
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

    const effectiveTournamentId = tournamentId || team.tournamentId;
    if (effectiveTournamentId) {
      const existingTournamentTeam = await this.prisma.teamMember.findFirst({
        where: {
          userId,
          team: { tournamentId: effectiveTournamentId },
        },
        select: { teamId: true },
      });
      if (existingTournamentTeam && existingTournamentTeam.teamId !== team.id) {
        throw new BadRequestException({
          success: false,
          status: 'error',
          code: 'ALREADY_IN_TOURNAMENT',
          error_code: 'ALREADY_IN_TOURNAMENT',
          message: 'You have already joined/registered for this tournament.',
        });
      }
    }

    const tournament = effectiveTournamentId
      ? await this.prisma.tournament.findUnique({
          where: { id: effectiveTournamentId },
          select: { teamMode: true },
        })
      : null;
    const maxMainPlayers = tournament?.teamMode === TeamMode.DUO ? 2 : 4;
    const maxRosterSize = maxMainPlayers + (team.acceptingSubstitutes ? 1 : 0);
    if (team.members.length >= maxRosterSize) {
      throw new BadRequestException({
        code: 'ROSTER_FULL',
        error_code: 'ROSTER_FULL',
        message: `Team roster is full (maximum ${maxRosterSize} members allowed)`,
      });
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
        throw new BadRequestException({
          code: 'ROSTER_FULL',
          error_code: 'ROSTER_FULL',
          message: 'Team already has a substitute player',
        });
      }
      targetRole = TeamMemberRole.SUBSTITUTE;
    } else {
      if (mainPlayers.length >= maxMainPlayers) {
        throw new BadRequestException({
          code: 'ROSTER_FULL',
          error_code: 'ROSTER_FULL',
          message: `Main roster is full (maximum ${maxMainPlayers} players). You can join as a substitute if the team accepts substitutes.`,
        });
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
        throw new BadRequestException({
          code: 'ALREADY_IN_TOURNAMENT',
          error_code: 'ALREADY_IN_TOURNAMENT',
          message:
            'You are already registered with another team in an active tournament this team is participating in',
        });
      }
    }

    return {
      profile,
      targetRole,
      isJoiningAsSubstitute,
      maxMainPlayers,
    };
  }

  async addMemberToTeam(
    teamId: string,
    userId: string,
    targetRole: TeamMemberRole = TeamMemberRole.PLAYER,
  ): Promise<TeamWithMembers> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true },
    });
    const beforeMain = team
      ? team.members
          .filter((m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER)
          .map((m) => m.userId)
      : [];
    const beforeCaptainId = team?.captainId ?? '';

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.teamMember.create({
          data: {
            teamId,
            userId,
            role: targetRole,
          },
        });

        await handleRosterChange(
          tx,
          teamId,
          { captainId: beforeCaptainId, mainUserIds: beforeMain },
          this.events,
          userId,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('You are already a member of this team');
      }
      throw error;
    }

    if (this.squadsService) {
      await this.squadsService.syncTeamToSquad(teamId);
    }

    return this.getTeamById(teamId, userId);
  }

  async joinTeam(
    userId: string,
    dto: JoinTeamDto,
    teamId?: string,
    tournamentId?: string,
  ): Promise<any> {
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

    const { targetRole, isJoiningAsSubstitute, maxMainPlayers } =
      await this.verifyJoinEligibility(userId, team, dto, tournamentId);

    if (team.requireJoinApproval) {
      const pendingCount = await this.prisma.teamJoinRequest.count({
        where: { userId, status: TeamJoinRequestStatus.PENDING },
      });
      if (pendingCount >= 5) {
        throw new BadRequestException({
          code: 'JOIN_REQUEST_LIMIT',
          error_code: 'JOIN_REQUEST_LIMIT',
          message: 'You have reached the limit of 5 pending join requests',
        });
      }

      const buildPreview = async (reqStatus: TeamJoinRequestStatus) => {
        const fullTeam = await this.prisma.team.findUnique({
          where: { id: team!.id },
          include: {
            captain: true,
            members: {
              include: {
                user: { select: { id: true, name: true, profilePic: true } },
              },
            },
          },
        });
        const isRegistered = team!.tournamentId
          ? !!(await this.prisma.tournamentRegistration.findUnique({
              where: {
                unique_tournament_team: {
                  tournamentId: team!.tournamentId,
                  teamId: team!.id,
                },
              },
            }))
          : false;

        return toPrivacySafeTeamPreview({
          team: fullTeam as any,
          maxMain: maxMainPlayers,
          maxSub: 1,
          isRegistered,
          currentUserId: userId,
          myRequestStatus: reqStatus as any,
        });
      };

      const existingRequest = await this.prisma.teamJoinRequest.findFirst({
        where: {
          teamId: team.id,
          userId,
          status: TeamJoinRequestStatus.PENDING,
        },
      });

      if (existingRequest) {
        const preview = await buildPreview(TeamJoinRequestStatus.PENDING);
        return {
          join_status: 'PENDING' as const,
          request: {
            id: existingRequest.id,
            team_id: existingRequest.teamId,
            user_id: existingRequest.userId,
            status: existingRequest.status,
            requested_as_substitute: existingRequest.requestedAsSubstitute,
            created_at: existingRequest.createdAt,
          },
          team: preview,
        };
      }

      const newRequest = await this.prisma.teamJoinRequest.create({
        data: {
          teamId: team.id,
          userId,
          requestedAsSubstitute: isJoiningAsSubstitute,
          status: TeamJoinRequestStatus.PENDING,
        },
      });

      const callerUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      this.events?.emit('team.join_requested', {
        teamId: team.id,
        tournamentId: team.tournamentId,
        captainId: team.captainId,
        requesterId: userId,
        requesterName: callerUser?.name || 'A player',
        teamName: team.name,
        requestId: newRequest.id,
      });

      const preview = await buildPreview(TeamJoinRequestStatus.PENDING);
      return {
        join_status: 'PENDING' as const,
        request: {
          id: newRequest.id,
          team_id: newRequest.teamId,
          user_id: newRequest.userId,
          status: newRequest.status,
          requested_as_substitute: newRequest.requestedAsSubstitute,
          created_at: newRequest.createdAt,
        },
        team: preview,
      };
    }

    const updatedTeam = await this.addMemberToTeam(team.id, userId, targetRole);
    return {
      ...toTeamResponse(updatedTeam, userId),
      join_status: 'JOINED' as const,
    };
  }

  async getPendingJoinRequests(captainId: string, teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    if (team.captainId !== captainId) {
      throw new ForbiddenException({
        code: 'NOT_TEAM_OWNER',
        error_code: 'NOT_TEAM_OWNER',
        message: 'Only the team captain or manager can view join requests',
      });
    }

    const requests = await this.prisma.teamJoinRequest.findMany({
      where: {
        teamId,
        status: TeamJoinRequestStatus.PENDING,
      },
      include: {
        user: {
          include: {
            gameProfiles: {
              where: { gameId: team.gameId },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((req) => {
      const profile = req.user.gameProfiles[0];
      return {
        id: req.id,
        user: {
          id: req.user.id,
          name: req.user.name,
          profile_pic: req.user.profilePic,
        },
        in_game_name: profile?.inGameName ?? null,
        in_game_uid: profile?.inGameUid ?? null,
        requested_as_substitute: req.requestedAsSubstitute,
        created_at: req.createdAt,
      };
    });
  }

  async approveJoinRequest(captainId: string, teamId: string, requestId: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          include: { members: true },
        });
        if (!team) {
          throw new NotFoundException({
            code: 'TEAM_NOT_FOUND',
            message: 'Team not found',
          });
        }
        if (team.captainId !== captainId) {
          throw new ForbiddenException({
            code: 'NOT_TEAM_OWNER',
            error_code: 'NOT_TEAM_OWNER',
            message: 'Only the team captain or manager can approve join requests',
          });
        }

        const request = await tx.teamJoinRequest.findUnique({
          where: { id: requestId },
        });
        if (!request || request.teamId !== teamId) {
          throw new NotFoundException({
            code: 'JOIN_REQUEST_NOT_FOUND',
            error_code: 'JOIN_REQUEST_NOT_FOUND',
            message: 'Join request not found',
          });
        }
        if (request.status !== TeamJoinRequestStatus.PENDING) {
          throw new BadRequestException({
            code: 'JOIN_REQUEST_NOT_PENDING',
            error_code: 'JOIN_REQUEST_NOT_PENDING',
            message: 'Join request is not pending',
          });
        }

        // Assert roster unlocked
        if (
          team.registrationState === TeamRegistrationState.CONFIRMED ||
          team.registrationState === TeamRegistrationState.WAITLISTED
        ) {
          throw new BadRequestException({
            code: 'TEAM_ROSTER_LOCKED',
            error_code: 'TEAM_ROSTER_LOCKED',
            message: 'The team roster cannot be changed after tournament registration.',
          });
        }
        const beforeMain = team.members
          .filter((m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER)
          .map((m) => m.userId);
        const beforeCaptainId = team.captainId;
        const registration = await tx.tournamentRegistration.findFirst({
          where: { teamId, status: RegistrationStatus.CONFIRMED },
          select: { id: true },
        });
        if (registration) {
          throw new BadRequestException({
            code: 'TEAM_ROSTER_LOCKED',
            error_code: 'TEAM_ROSTER_LOCKED',
            message: 'The team roster cannot be changed after tournament registration.',
          });
        }

        // Re-check user not already a member
        const isMember = team.members.some((m) => m.userId === request.userId);
        if (isMember) {
          const updatedReq = await tx.teamJoinRequest.update({
            where: { id: requestId },
            data: {
              status: TeamJoinRequestStatus.APPROVED,
              resolvedAt: new Date(),
              resolvedBy: captainId,
            },
          });
          return { team, request: updatedReq, alreadyMember: true };
        }

        // User not in another team of the same tournament
        if (team.tournamentId) {
          const existingTournamentTeam = await tx.teamMember.findFirst({
            where: {
              userId: request.userId,
              team: { tournamentId: team.tournamentId },
            },
            select: { teamId: true },
          });
          if (existingTournamentTeam && existingTournamentTeam.teamId !== team.id) {
            throw new BadRequestException({
              code: 'ALREADY_IN_TOURNAMENT',
              error_code: 'ALREADY_IN_TOURNAMENT',
              message: 'User is already registered with another team in this tournament.',
            });
          }
        }

        // Check capacity for requested role
        const tournament = team.tournamentId
          ? await tx.tournament.findUnique({
              where: { id: team.tournamentId },
              select: { teamMode: true },
            })
          : null;
        const maxMainPlayers = tournament?.teamMode === TeamMode.DUO ? 2 : 4;

        const mainPlayers = team.members.filter(
          (m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
        );
        const existingSub = team.members.some((m) => m.role === TeamMemberRole.SUBSTITUTE);

        let targetRole: TeamMemberRole = TeamMemberRole.PLAYER;
        if (request.requestedAsSubstitute) {
          if (!team.acceptingSubstitutes || existingSub) {
            throw new BadRequestException({
              code: 'ROSTER_FULL',
              error_code: 'ROSTER_FULL',
              message: 'Team roster is full for the requested substitute role',
            });
          }
          targetRole = TeamMemberRole.SUBSTITUTE;
        } else {
          if (mainPlayers.length >= maxMainPlayers) {
            throw new BadRequestException({
              code: 'ROSTER_FULL',
              error_code: 'ROSTER_FULL',
              message: `Team roster is full (maximum ${maxMainPlayers} main players allowed)`,
            });
          }
          targetRole = TeamMemberRole.PLAYER;
        }

        // Insert member
        const member = await tx.teamMember.create({
          data: {
            teamId: team.id,
            userId: request.userId,
            role: targetRole,
          },
        });

        // Mark request APPROVED
        const updatedReq = await tx.teamJoinRequest.update({
          where: { id: requestId },
          data: {
            status: TeamJoinRequestStatus.APPROVED,
            resolvedAt: new Date(),
            resolvedBy: captainId,
          },
        });

        await handleRosterChange(
          tx,
          team.id,
          { captainId: beforeCaptainId, mainUserIds: beforeMain },
          this.events,
          captainId,
        );

        return { team, request: { ...request, ...updatedReq }, member, alreadyMember: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (this.squadsService) {
      await this.squadsService.syncTeamToSquad(teamId);
    }

    this.events?.emit('team.join_approved', {
      teamId: result.team.id,
      tournamentId: result.team.tournamentId,
      requesterId: result.request.userId,
      teamName: result.team.name,
      requestId: result.request.id,
    });

    return {
      success: true,
      status: 'APPROVED',
      message: 'Join request approved',
      request: result.request,
    };
  }

  async rejectJoinRequest(captainId: string, teamId: string, requestId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    if (team.captainId !== captainId) {
      throw new ForbiddenException({
        code: 'NOT_TEAM_OWNER',
        error_code: 'NOT_TEAM_OWNER',
        message: 'Only the team captain or manager can reject join requests',
      });
    }

    const request = await this.prisma.teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.teamId !== teamId) {
      throw new NotFoundException({
        code: 'JOIN_REQUEST_NOT_FOUND',
        error_code: 'JOIN_REQUEST_NOT_FOUND',
        message: 'Join request not found',
      });
    }
    if (request.status !== TeamJoinRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'JOIN_REQUEST_NOT_PENDING',
        error_code: 'JOIN_REQUEST_NOT_PENDING',
        message: 'Join request is not pending',
      });
    }

    const updated = await this.prisma.teamJoinRequest.update({
      where: { id: requestId },
      data: {
        status: TeamJoinRequestStatus.REJECTED,
        resolvedAt: new Date(),
        resolvedBy: captainId,
      },
    });

    this.events?.emit('team.join_rejected', {
      teamId: team.id,
      tournamentId: team.tournamentId,
      requesterId: request.userId,
      teamName: team.name,
      requestId: request.id,
    });

    return {
      success: true,
      status: 'REJECTED',
      message: 'Join request rejected',
      request: updated,
    };
  }

  async cancelJoinRequest(userId: string, requestId: string) {
    const request = await this.prisma.teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException({
        code: 'JOIN_REQUEST_NOT_FOUND',
        error_code: 'JOIN_REQUEST_NOT_FOUND',
        message: 'Join request not found',
      });
    }
    if (request.userId !== userId) {
      throw new ForbiddenException('You can only cancel your own join request');
    }
    if (request.status !== TeamJoinRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'JOIN_REQUEST_NOT_PENDING',
        error_code: 'JOIN_REQUEST_NOT_PENDING',
        message: 'Join request is not pending',
      });
    }

    const updated = await this.prisma.teamJoinRequest.update({
      where: { id: requestId },
      data: {
        status: TeamJoinRequestStatus.CANCELLED,
        resolvedAt: new Date(),
        resolvedBy: userId,
      },
    });

    return {
      success: true,
      status: 'CANCELLED',
      message: 'Join request cancelled',
      request: updated,
    };
  }

  async getUserJoinRequests(userId: string, status?: TeamJoinRequestStatus) {
    const targetStatus = status || TeamJoinRequestStatus.PENDING;
    const requests = await this.prisma.teamJoinRequest.findMany({
      where: {
        userId,
        status: targetStatus,
      },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            tournamentId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((r) => ({
      id: r.id,
      status: r.status,
      requested_as_substitute: r.requestedAsSubstitute,
      created_at: r.createdAt,
      resolved_at: r.resolvedAt,
      team: {
        id: r.team.id,
        name: r.team.name,
        tag: r.team.tag,
        logo_url: r.team.logoUrl,
        tournament_id: r.team.tournamentId,
      },
    }));
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

    const beforeMain = team.members
      .filter((m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER)
      .map((m) => m.userId);
    const beforeCaptainId = team.captainId;

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.delete({
        where: {
          unique_team_user: {
            teamId,
            userId,
          },
        },
      });

      await handleRosterChange(
        tx,
        teamId,
        { captainId: beforeCaptainId, mainUserIds: beforeMain },
        this.events,
        userId,
      );
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

    const beforeMain = team.members
      .filter((m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER)
      .map((m) => m.userId);
    const beforeCaptainId = team.captainId;

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.delete({
        where: {
          unique_team_user: {
            teamId,
            userId: targetUserId,
          },
        },
      });

      await handleRosterChange(
        tx,
        teamId,
        { captainId: beforeCaptainId, mainUserIds: beforeMain },
        this.events,
        captainId,
      );
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

    const beforeMain = team.members
      .filter((m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER)
      .map((m) => m.userId);
    const beforeCaptainId = team.captainId;

    await this.prisma.$transaction(async (tx) => {
      // Downgrade current captain/manager to PLAYER
      await tx.teamMember.update({
        where: {
          unique_team_user: {
            teamId,
            userId: captainId,
          },
        },
        data: { role: TeamMemberRole.PLAYER },
      });
      // Upgrade target member to CAPTAIN or MANAGER
      await tx.teamMember.update({
        where: {
          unique_team_user: {
            teamId,
            userId: newCaptainId,
          },
        },
        data: { role: newRoleForNewOwner },
      });
      // Update team captainId
      await tx.team.update({
        where: { id: teamId },
        data: { captainId: newCaptainId },
      });

      await handleRosterChange(
        tx,
        teamId,
        { captainId: beforeCaptainId, mainUserIds: beforeMain },
        this.events,
        captainId,
      );
    });

    return this.getTeamById(teamId);
  }

  async updatePlayingRoster(
    ownerId: string,
    teamId: string,
    mainUserIds: string[],
  ): Promise<TeamWithMembers> {
    const team = await this.getTeamById(teamId, ownerId);
    if (!team.tournamentId) {
      throw new BadRequestException({
        code: 'TEAM_NOT_TOURNAMENT_SCOPED',
        error_code: 'TEAM_NOT_TOURNAMENT_SCOPED',
        message: 'Playing roster management is only available for tournament teams',
      });
    }

    if (team.captainId !== ownerId) {
      throw new ForbiddenException({
        code: 'NOT_TEAM_OWNER',
        error_code: 'NOT_TEAM_OWNER',
        message: 'Only the team owner can change the playing roster',
      });
    }

    if (
      team.registrationState === TeamRegistrationState.CONFIRMED ||
      team.registrationState === TeamRegistrationState.WAITLISTED
    ) {
      throw new BadRequestException({
        code: 'TEAM_ROSTER_LOCKED',
        error_code: 'TEAM_ROSTER_LOCKED',
        message: 'The team roster cannot be changed after tournament registration.',
      });
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: team.tournamentId },
      select: { teamMode: true },
    });
    const requiredMainCount = tournament?.teamMode === TeamMode.DUO ? 2 : 4;

    const uniqueMainIds = Array.from(new Set(mainUserIds));
    if (uniqueMainIds.length !== requiredMainCount) {
      throw new BadRequestException({
        code: 'INVALID_PLAYING_ROSTER',
        error_code: 'INVALID_PLAYING_ROSTER',
        message: `Playing roster must contain exactly ${requiredMainCount} unique players`,
      });
    }

    const teamMemberMap = new Map(team.members.map((m) => [m.userId, m]));
    for (const uid of uniqueMainIds) {
      const member = teamMemberMap.get(uid);
      if (!member) {
        throw new BadRequestException({
          code: 'INVALID_PLAYING_ROSTER',
          error_code: 'INVALID_PLAYING_ROSTER',
          message: `User ${uid} is not a member of this team`,
        });
      }
      if (member.role === TeamMemberRole.MANAGER) {
        throw new BadRequestException({
          code: 'MANAGER_CANNOT_PLAY',
          error_code: 'MANAGER_CANNOT_PLAY',
          message: 'Team managers cannot be in the playing roster',
        });
      }
    }

    if (team.ownerRole === OwnerRole.LEADER && !uniqueMainIds.includes(team.captainId)) {
      throw new BadRequestException({
        code: 'LEADER_MUST_PLAY',
        error_code: 'LEADER_MUST_PLAY',
        message: 'The team leader must be included in the playing roster',
      });
    }

    const substituteCandidates = team.members.filter(
      (m) => m.role !== TeamMemberRole.MANAGER && !uniqueMainIds.includes(m.userId),
    );

    if (substituteCandidates.length > 0) {
      if (!team.acceptingSubstitutes) {
        throw new BadRequestException({
          code: 'SUBSTITUTE_LIMIT',
          error_code: 'SUBSTITUTE_LIMIT',
          message: 'This team is not currently accepting substitutes',
        });
      }
      if (substituteCandidates.length > 1) {
        throw new BadRequestException({
          code: 'SUBSTITUTE_LIMIT',
          error_code: 'SUBSTITUTE_LIMIT',
          message: 'Maximum 1 substitute player allowed',
        });
      }
    }

    const beforeMain = team.members
      .filter((m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER)
      .map((m) => m.userId);
    const beforeCaptainId = team.captainId;

    await this.prisma.$transaction(
      async (tx) => {
        for (const member of team.members) {
          if (member.role === TeamMemberRole.MANAGER || member.role === TeamMemberRole.CAPTAIN) {
            continue;
          }

          if (uniqueMainIds.includes(member.userId) && member.role === TeamMemberRole.SUBSTITUTE) {
            await tx.teamMember.update({
              where: { id: member.id },
              data: { role: TeamMemberRole.PLAYER },
            });
          } else if (!uniqueMainIds.includes(member.userId) && member.role === TeamMemberRole.PLAYER) {
            await tx.teamMember.update({
              where: { id: member.id },
              data: { role: TeamMemberRole.SUBSTITUTE },
            });
          }
        }

        await handleRosterChange(
          tx,
          teamId,
          { captainId: beforeCaptainId, mainUserIds: beforeMain },
          this.events,
          ownerId,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.getTeamById(teamId, ownerId);
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

    const requireApproval = dto.require_join_approval ?? dto.requireJoinApproval;

    await this.prisma.team.update({
      where: { id: teamId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.tag ? { tag: dto.tag.toUpperCase() } : {}),
        ...(dto.logo_url !== undefined ? { logoUrl: dto.logo_url } : {}),
        ...(requireApproval !== undefined ? { requireJoinApproval: requireApproval } : {}),
      },
    });

    return this.getTeamById(teamId, captainId);
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

  async assertRosterUnlocked(teamId: string): Promise<void> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { registrationState: true },
    });
    if (
      team?.registrationState === TeamRegistrationState.CONFIRMED ||
      team?.registrationState === TeamRegistrationState.WAITLISTED
    ) {
      throw new BadRequestException({
        code: 'TEAM_ROSTER_LOCKED',
        error_code: 'TEAM_ROSTER_LOCKED',
        message: 'The team roster cannot be changed after tournament registration.',
      });
    }

    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: { teamId, status: RegistrationStatus.CONFIRMED },
      select: { id: true },
    });
    if (registration) {
      throw new BadRequestException({
        code: 'TEAM_ROSTER_LOCKED',
        error_code: 'TEAM_ROSTER_LOCKED',
        message: 'The team roster cannot be changed after tournament registration.',
      });
    }
  }
}
