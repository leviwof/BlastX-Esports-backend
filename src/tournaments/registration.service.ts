import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  TournamentStatus,
  TeamMode,
  TeamMemberRole,
  OwnerRole,
  RegistrationStatus,
  TeamRegistrationState,
  RegistrationSubmissionStatus,
  RegistrationApprovalStatus,
  WaitlistEntryStatus,
  SquadRole,
  SquadRosterType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterTournamentDto } from './dto/register-tournament.dto';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  /**
   * Finalizes slot allocation and tournament registration atomically.
   * If capacity is full at that moment: sets team.registration_state = WAITLISTED,
   * keeps submission ACTIVE, emits tournament.waitlisted, and logs event without throwing.
   */
  async finalizeRegistration(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    teamId: string | null,
    userId: string,
    submissionId?: string | null,
  ): Promise<{
    status: 'CONFIRMED' | 'WAITLISTED';
    slotNumber: number | null;
    registration?: any;
    position?: number;
    size?: number;
  }> {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.status && tournament.status !== TournamentStatus.LIVE) {
      throw new BadRequestException({
        code: 'TOURNAMENT_NOT_LIVE',
        error_code: 'TOURNAMENT_NOT_LIVE',
        message: `Registration opens only when the tournament is LIVE (current status: ${tournament.status})`,
      });
    }

    if (tournament.entryFee > 0) {
      const paidEnabled = this.config.get<string>('PAID_TOURNAMENTS_ENABLED') === 'true';
      throw new BadRequestException({
        code: 'PAID_TOURNAMENTS_UNAVAILABLE',
        error_code: 'PAID_TOURNAMENTS_UNAVAILABLE',
        message: paidEnabled
          ? 'Paid tournaments require wallet support and are not available yet'
          : 'Paid tournaments are not enabled yet',
      });
    }

    let participantUserIds: string[] = [];
    let registeredTeam: any = null;

    if (tournament.teamMode === TeamMode.SOLO) {
      participantUserIds = [userId];
      const profile = await tx.gameProfile.findUnique({
        where: { unique_user_game: { userId, gameId: tournament.gameId } },
      });
      if (!profile) {
        throw new BadRequestException('You must set up your Free Fire game profile before registering for a tournament');
      }
    } else {
      if (!teamId) {
        throw new BadRequestException(`A team_id is required for ${tournament.teamMode} tournaments`);
      }
      registeredTeam = await tx.team.findUnique({
        where: { id: teamId },
        include: {
          members: {
            include: { user: { include: { gameProfiles: true } } },
          },
          captain: { select: { id: true, name: true } },
        },
      });
      if (!registeredTeam) {
        throw new NotFoundException('Team not found');
      }

      const mainMembers = registeredTeam.members.filter(
        (m: any) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
      );
      participantUserIds = mainMembers.map((m: any) => m.userId);

      if (tournament.teamMode === TeamMode.DUO && mainMembers.length < 2) {
        throw new BadRequestException('A DUO tournament requires a team with at least 2 players');
      }
      if (tournament.teamMode === TeamMode.SQUAD && mainMembers.length !== 4) {
        throw new BadRequestException({
          status: 'error',
          code: 'INVALID_MEMBER_COUNT',
          error_code: 'INVALID_MEMBER_COUNT',
          message: 'Tournament registration requires exactly 4 main players in your team.',
        });
      }

      const profiles = await tx.gameProfile.findMany({
        where: {
          gameId: tournament.gameId,
          userId: { in: participantUserIds },
        },
      });
      if (profiles.length < participantUserIds.length) {
        throw new BadRequestException('All team members must set up a Free Fire game profile before joining');
      }

      // Check ALREADY_IN_TOURNAMENT conflicts
      const conflictingReg = await tx.tournamentRegistration.findFirst({
        where: {
          tournamentId,
          status: RegistrationStatus.CONFIRMED,
          teamId: { not: teamId },
          team: {
            members: {
              some: {
                userId: { in: participantUserIds },
                role: { not: TeamMemberRole.SUBSTITUTE },
              },
            },
          },
        },
      });
      if (conflictingReg) {
        throw new BadRequestException({
          code: 'ALREADY_IN_TOURNAMENT',
          error_code: 'ALREADY_IN_TOURNAMENT',
          message: 'One or more of your team members are already registered in another team for this tournament',
        });
      }

      const formingConflict = await tx.team.findFirst({
        where: {
          tournamentId,
          id: { not: teamId },
          members: { some: { userId: { in: participantUserIds } } },
        },
        select: { id: true },
      });
      if (formingConflict) {
        throw new BadRequestException({
          code: 'ALREADY_IN_TOURNAMENT',
          error_code: 'ALREADY_IN_TOURNAMENT',
          message: 'One or more team members already belong to another team for this tournament',
        });
      }
    }

    // Atomic conditional slot increment
    const updateResult = await tx.tournament.updateMany({
      where: {
        id: tournamentId,
        status: TournamentStatus.LIVE,
        registeredCount: { lt: tournament.maxSlots },
      },
      data: {
        registeredCount: { increment: 1 },
      },
    });

    if (!updateResult || updateResult.count === 0) {
      // Capacity is full: mark WAITLISTED, keep submission ACTIVE, emit tournament.waitlisted
      let waitlistEntry: any = null;
      if (teamId) {
        await tx.team.update({
          where: { id: teamId },
          data: { registrationState: TeamRegistrationState.WAITLISTED },
        });

        // Create or reuse team's WAITING entry (idempotent)
        const existingEntry = await tx.tournamentWaitlistEntry.findUnique({
          where: { tournamentId_teamId: { tournamentId, teamId } },
        });

        if (existingEntry) {
          waitlistEntry = await tx.tournamentWaitlistEntry.update({
            where: { id: existingEntry.id },
            data: {
              status: WaitlistEntryStatus.WAITING,
              reason: 'Tournament capacity full',
              resolvedAt: null,
            },
          });
        } else {
          waitlistEntry = await tx.tournamentWaitlistEntry.create({
            data: {
              tournamentId,
              teamId,
              status: WaitlistEntryStatus.WAITING,
              reason: 'Tournament capacity full',
            },
          });
        }

        await tx.registrationEvent.create({
          data: {
            tournamentId,
            teamId,
            submissionId: submissionId ?? null,
            actorUserId: userId,
            eventType: 'REGISTRATION_WAITLISTED',
            rosterVersion: registeredTeam?.rosterVersion ?? 1,
            details: { reason: 'Tournament capacity full' },
          },
        });
      }

      // Compute position and size at read time:
      // Position = 1 + number of WAITING entries of this tournament with earlier created_at
      const earlierWaitingCount = waitlistEntry
        ? await tx.tournamentWaitlistEntry.count({
            where: {
              tournamentId,
              status: WaitlistEntryStatus.WAITING,
              createdAt: { lt: waitlistEntry.createdAt },
            },
          })
        : 0;
      const position = earlierWaitingCount + 1;

      const waitlistSize = await tx.tournamentWaitlistEntry.count({
        where: {
          tournamentId,
          status: WaitlistEntryStatus.WAITING,
        },
      });

      const slotUserIds = registeredTeam?.members
        ? registeredTeam.members.map((m: any) => m.userId)
        : [userId];

      this.events.emit('tournament.waitlisted', {
        teamId,
        position,
        size: waitlistSize,
        userIds: slotUserIds,
        tournamentTitle: tournament.title,
        tournamentId,
      });

      return {
        status: 'WAITLISTED',
        slotNumber: null,
        position,
        size: waitlistSize,
      };
    }

    // Slot successfully allocated: assign lowest free slot_number between 1 and max_slots among CONFIRMED
    const confirmedRegistrations = await tx.tournamentRegistration.findMany({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
      },
      select: { slotNumber: true },
    });
    const usedSlots = new Set((confirmedRegistrations || []).map((r: any) => r.slotNumber));
    let slotNumber = 1;
    for (let s = 1; s <= tournament.maxSlots; s++) {
      if (!usedSlots.has(s)) {
        slotNumber = s;
        break;
      }
    }

    const registration = await tx.tournamentRegistration.create({
      data: {
        tournamentId,
        userId,
        teamId,
        status: RegistrationStatus.CONFIRMED,
        slotNumber,
      },
      include: {
        user: true,
        team: true,
      },
    });

    if (teamId) {
      // If team had an active waitlist entry, mark it PROMOTED
      await tx.tournamentWaitlistEntry.updateMany({
        where: { tournamentId, teamId, status: WaitlistEntryStatus.WAITING },
        data: { status: WaitlistEntryStatus.PROMOTED, resolvedAt: new Date() },
      });

      await tx.team.update({
        where: { id: teamId },
        data: { registrationState: TeamRegistrationState.CONFIRMED },
      });

      if (submissionId) {
        await tx.registrationSubmission.update({
          where: { id: submissionId },
          data: {
            status: RegistrationSubmissionStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
      }

      await tx.registrationEvent.create({
        data: {
          tournamentId,
          teamId,
          submissionId: submissionId ?? null,
          actorUserId: userId,
          eventType: 'REGISTRATION_CONFIRMED',
          rosterVersion: registeredTeam?.rosterVersion ?? 1,
          details: { slotNumber },
        },
      });

      // Persistent squad sync for SQUAD tournaments
      if (tournament.teamMode === TeamMode.SQUAD && registeredTeam && !registeredTeam.persistentSquadId) {
        const registeredMemberIds = registeredTeam.members.map((m: any) => m.userId).sort();
        let squad = await tx.squad.findUnique({
          where: {
            gameId_leaderId: {
              gameId: registeredTeam.gameId,
              leaderId: registeredTeam.captainId,
            },
          },
          include: { members: { select: { userId: true } } },
        });

        if (!squad) {
          const existingMemberships = await tx.squadMember.count({
            where: { userId: { in: registeredMemberIds } },
          });
          if (existingMemberships === 0) {
            const squadOwnerRole = registeredTeam.ownerRole ?? OwnerRole.LEADER;
            squad = await tx.squad.create({
              data: {
                gameId: registeredTeam.gameId,
                name: registeredTeam.name,
                tag: registeredTeam.tag,
                logoUrl: registeredTeam.logoUrl,
                leaderId: registeredTeam.captainId,
                ownerRole: squadOwnerRole,
                members: {
                  create: registeredTeam.members.map((member: any) => ({
                    userId: member.userId,
                    role:
                      member.userId === registeredTeam.captainId
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
              include: { members: { select: { userId: true } } },
            });
          }
        }

        if (
          squad &&
          squad.members.map((m: any) => m.userId).sort().join(',') === registeredMemberIds.join(',')
        ) {
          await tx.team.update({
            where: { id: registeredTeam.id },
            data: { persistentSquadId: squad.id },
          });
          const positionInQueue = await tx.tournamentWaitlist.count({
            where: {
              tournamentId,
              status: { not: 'CANCELLED' },
            },
          });
          await tx.tournamentWaitlist.upsert({
            where: {
              tournamentId_squadId: {
                tournamentId,
                squadId: squad.id,
              },
            },
            update: {},
            create: {
              tournamentId,
              squadId: squad.id,
              positionInQueue: positionInQueue + 1,
              status: 'CONFIRMED',
            },
          });
        }
      }
    }

    const slotUserIds = registeredTeam
      ? registeredTeam.members.map((m: any) => m.userId)
      : [userId];

    // Emit confirmation events exactly once
    this.events.emit('registration.confirmed', {
      userId,
      tournamentId,
      tournamentTitle: tournament.title,
      slotNumber,
    });

    if (registeredTeam) {
      this.events.emit('squad.registered', {
        captainUserId: userId,
        captainName: registeredTeam.captain?.name || 'Your leader',
        teamName: registeredTeam.name,
        tournamentId,
        tournamentTitle: tournament.title,
        memberUserIds: slotUserIds,
      });
    }

    this.events.emit('tournament.slot_confirmed', {
      userIds: slotUserIds,
      tournamentTitle: tournament.title,
      tournamentId,
      slotNumber,
    });

    return {
      status: 'CONFIRMED',
      slotNumber,
      registration,
    };
  }

  /**
   * Main registration handler for POST /v1/tournaments/:id/register
   */
  async register(
    userId: string,
    tournamentId: string,
    dto: RegisterTournamentDto,
  ): Promise<any> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.status !== TournamentStatus.LIVE) {
      throw new BadRequestException(
        `Registration opens only when the tournament is LIVE (current status: ${tournament.status})`,
      );
    }

    if (tournament.entryFee > 0) {
      const paidEnabled = this.config.get<string>('PAID_TOURNAMENTS_ENABLED') === 'true';
      throw new BadRequestException({
        code: 'PAID_TOURNAMENTS_UNAVAILABLE',
        error_code: 'PAID_TOURNAMENTS_UNAVAILABLE',
        message: paidEnabled
          ? 'Paid tournaments require wallet support and are not available yet'
          : 'Paid tournaments are not enabled yet',
      });
    }

    // SOLO mode: immediate finalization without player approvals
    if (tournament.teamMode === TeamMode.SOLO) {
      const existing = await this.prisma.tournamentRegistration.findFirst({
        where: {
          tournamentId,
          userId,
          status: RegistrationStatus.CONFIRMED,
        },
      });
      if (existing) {
        return existing;
      }

      return this.prisma.$transaction(
        async (tx) => {
          const res = await this.finalizeRegistration(tx, tournamentId, null, userId);
          return res.registration;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    }

    // SQUAD and DUO mode
    if (!dto.team_id) {
      throw new BadRequestException(`A team_id is required for ${tournament.teamMode} tournaments`);
    }
    const teamId = dto.team_id;

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, profilePic: true } } },
        },
        captain: { select: { id: true, name: true } },
      },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    if (team.tournamentId && team.tournamentId !== tournamentId) {
      throw new BadRequestException('This team was created for a different tournament');
    }
    if (team.gameId !== tournament.gameId) {
      throw new BadRequestException('Team is not configured for this game');
    }

    if (team.captainId !== userId) {
      throw new ForbiddenException({
        status: 'error',
        error_code: 'NON_LEADER_REGISTRATION_FORBIDDEN',
        message: 'please ask team leader to register the tournament',
      });
    }

    const userSquadMember = await this.prisma.squadMember.findUnique({
      where: { userId },
    });
    if (
      userSquadMember &&
      userSquadMember.role !== SquadRole.LEADER &&
      userSquadMember.role !== SquadRole.MANAGER
    ) {
      throw new ForbiddenException({
        status: 'error',
        error_code: 'NON_LEADER_REGISTRATION_FORBIDDEN',
        message: 'please ask team leader to register the tournament',
      });
    }

    // Check if team is already CONFIRMED -> Idempotent return
    if (team.registrationState === TeamRegistrationState.CONFIRMED) {
      const existingReg = await this.prisma.tournamentRegistration.findFirst({
        where: { tournamentId, teamId, status: RegistrationStatus.CONFIRMED },
        include: { user: true, team: true },
      });
      if (existingReg) {
        return {
          ...existingReg,
          registration_state: TeamRegistrationState.CONFIRMED,
          roster_version: team.rosterVersion,
          approvals_required: 0,
          approvals_approved: 0,
          slot_number: existingReg.slotNumber,
        };
      }
    }

    // Check playing roster composition
    const mainMembers = team.members.filter(
      (m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
    );
    const participantUserIds = mainMembers.map((m) => m.userId);

    if (tournament.teamMode === TeamMode.DUO && mainMembers.length < 2) {
      throw new BadRequestException('A DUO tournament requires a team with at least 2 players');
    }
    if (tournament.teamMode === TeamMode.SQUAD && mainMembers.length !== 4) {
      throw new BadRequestException({
        status: 'error',
        code: 'INVALID_MEMBER_COUNT',
        error_code: 'INVALID_MEMBER_COUNT',
        message: 'Tournament registration requires exactly 4 main players in your team.',
      });
    }

    // Check game profiles
    const profiles = await this.prisma.gameProfile.findMany({
      where: {
        gameId: tournament.gameId,
        userId: { in: participantUserIds },
      },
    });
    if (profiles.length < participantUserIds.length) {
      throw new BadRequestException('All team members must set up a Free Fire game profile before joining');
    }

    // Check existing registration conflicts in tournament
    const conflictingReg = await this.prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
        teamId: { not: teamId },
        team: {
          members: {
            some: {
              userId: { in: participantUserIds },
              role: { not: TeamMemberRole.SUBSTITUTE },
            },
          },
        },
      },
    });
    if (conflictingReg) {
      throw new BadRequestException(
        'One or more of your team members are already registered in another team for this tournament',
      );
    }

    const formingConflict = await this.prisma.team.findFirst({
      where: {
        tournamentId,
        id: { not: teamId },
        members: { some: { userId: { in: participantUserIds } } },
      },
      select: { id: true },
    });
    if (formingConflict) {
      throw new BadRequestException(
        'One or more team members already belong to another team for this tournament',
      );
    }

    // Allowed states: FORMING, ROSTER_CHANGE_REQUIRED, PENDING_PLAYER_APPROVAL
    const teamState = team.registrationState ?? TeamRegistrationState.FORMING;
    if (
      teamState !== TeamRegistrationState.FORMING &&
      teamState !== TeamRegistrationState.ROSTER_CHANGE_REQUIRED &&
      teamState !== TeamRegistrationState.PENDING_PLAYER_APPROVAL
    ) {
      throw new BadRequestException({
        code: 'TEAM_ROSTER_LOCKED',
        error_code: 'TEAM_ROSTER_LOCKED',
        message: `Cannot register team in state ${team.registrationState}`,
      });
    }

    // If PENDING_PLAYER_APPROVAL: idempotent return if an ACTIVE submission exists for current roster_version
    if (teamState === TeamRegistrationState.PENDING_PLAYER_APPROVAL) {
      const activeSubmission = await this.prisma.registrationSubmission.findFirst({
        where: {
          teamId,
          rosterVersion: team.rosterVersion,
          status: RegistrationSubmissionStatus.ACTIVE,
        },
        include: { approvals: true },
      });
      if (activeSubmission) {
        const approvedCount = activeSubmission.approvals.filter(
          (a) => a.status === RegistrationApprovalStatus.APPROVED,
        ).length;
        return {
          id: activeSubmission.id,
          registration_id: activeSubmission.id,
          tournament_id: tournamentId,
          team_id: teamId,
          user_id: userId,
          status: 'PENDING_APPROVAL',
          registration_state: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
          roster_version: team.rosterVersion,
          approvals_required: activeSubmission.approvals.length,
          approvals_approved: approvedCount,
          slot_number: null,
          created_at: activeSubmission.createdAt,
          message: 'Registration request already pending player approval',
        };
      }
    }

    // Determine approvers:
    // If owner_role = LEADER: every Playing player except the Leader
    // If owner_role = MANAGER: every Playing player
    const approverUserIds =
      team.ownerRole === OwnerRole.MANAGER
        ? participantUserIds
        : participantUserIds.filter((id) => id !== team.captainId);

    // If approval is disabled or no approvers required: finalize immediately
    if (!tournament.requirePlayerApproval || approverUserIds.length === 0) {
      return this.prisma.$transaction(
        async (tx) => {
          const res = await this.finalizeRegistration(tx, tournamentId, teamId, userId);
          return {
            ...res.registration,
            registration_state: res.status,
            roster_version: team.rosterVersion,
            approvals_required: 0,
            approvals_approved: 0,
            slot_number: res.slotNumber,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    }

    // Player approval workflow
    const result = await this.prisma.$transaction(
      async (tx) => {
        // Cancel previous ACTIVE submissions
        await tx.registrationSubmission.updateMany({
          where: {
            teamId,
            status: RegistrationSubmissionStatus.ACTIVE,
          },
          data: {
            status: RegistrationSubmissionStatus.CANCELLED,
          },
        });

        const submission = await tx.registrationSubmission.create({
          data: {
            tournamentId,
            teamId,
            rosterVersion: team.rosterVersion,
            submittedBy: userId,
            ownerUserId: team.captainId,
            playingUserIds: participantUserIds,
            status: RegistrationSubmissionStatus.ACTIVE,
          },
        });

        await tx.registrationApproval.createMany({
          data: approverUserIds.map((approverId) => ({
            submissionId: submission.id,
            userId: approverId,
            status: RegistrationApprovalStatus.PENDING,
          })),
        });

        const createdApprovals = await tx.registrationApproval.findMany({
          where: { submissionId: submission.id },
        });

        await tx.team.update({
          where: { id: teamId },
          data: { registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL },
        });

        await tx.registrationEvent.create({
          data: {
            tournamentId,
            teamId,
            submissionId: submission.id,
            actorUserId: userId,
            eventType: 'SUBMISSION_CREATED',
            rosterVersion: team.rosterVersion,
            details: {
              approverUserIds,
              playingUserIds: participantUserIds,
            },
          },
        });

        return {
          submission,
          approvals: createdApprovals,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Emit approval requests after commit
    for (const approval of result.approvals) {
      this.events.emit('registration.approval_requested', {
        approvalId: approval.id,
        approverUserId: approval.userId,
        tournamentId,
        tournamentTitle: tournament.title,
        teamId: team.id,
        teamName: team.name,
        ownerName: team.captain?.name || 'Your leader',
      });
    }

    return {
      id: result.submission.id,
      registration_id: result.submission.id,
      tournament_id: tournamentId,
      team_id: teamId,
      user_id: userId,
      status: 'PENDING_APPROVAL',
      registration_state: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
      roster_version: team.rosterVersion,
      approvals_required: result.approvals.length,
      approvals_approved: 0,
      slot_number: null,
      created_at: result.submission.createdAt,
      message: 'Registration request submitted for player approval',
    };
  }

  /**
   * GET /v1/users/me/registration-approvals?status=PENDING|ALL
   */
  async getUserApprovals(
    userId: string,
    status?: 'PENDING' | 'ALL',
  ): Promise<{ items: any[] }> {
    const isPendingOnly = (status || 'PENDING').toUpperCase() === 'PENDING';

    const approvals = await this.prisma.registrationApproval.findMany({
      where: {
        userId,
        ...(isPendingOnly
          ? {
              status: RegistrationApprovalStatus.PENDING,
              submission: {
                status: RegistrationSubmissionStatus.ACTIVE,
                team: {
                  registrationState: TeamRegistrationState.PENDING_PLAYER_APPROVAL,
                },
              },
            }
          : {}),
      },
      include: {
        submission: {
          include: {
            tournament: {
              select: {
                id: true,
                title: true,
                bannerUrl: true,
                startsAt: true,
                status: true,
              },
            },
            team: {
              include: {
                captain: { select: { id: true, name: true } },
                members: {
                  include: {
                    user: { select: { id: true, name: true, profilePic: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const items = approvals.map((approval) => {
      const sub = approval.submission;
      const team = sub.team;
      const tournament = sub.tournament;

      const playingMembers = team.members.filter(
        (m) =>
          sub.playingUserIds.includes(m.userId) &&
          m.role !== TeamMemberRole.SUBSTITUTE &&
          m.role !== TeamMemberRole.MANAGER,
      );

      const responsibleRole = team.ownerRole === OwnerRole.MANAGER ? 'MANAGER' : 'LEADER';
      const responsibleName =
        team.captain?.name ||
        team.members.find((m) => m.userId === team.captainId)?.user?.name ||
        'Leader';

      return {
        id: approval.id,
        status: approval.status,
        roster_version: sub.rosterVersion,
        created_at: approval.createdAt,
        tournament: {
          id: tournament.id,
          title: tournament.title,
          banner_url: tournament.bannerUrl,
          starts_at: tournament.startsAt,
        },
        team: {
          id: team.id,
          name: team.name,
          tag: team.tag,
          logo_url: team.logoUrl,
        },
        responsible_person: {
          name: responsibleName,
          role: responsibleRole,
        },
        playing_players: playingMembers.map((m) => ({
          user_id: m.userId,
          name: m.user?.name || 'Player',
          avatar: m.user?.profilePic || null,
          role: m.role,
        })),
      };
    });

    return { items };
  }

  /**
   * GET /v1/registration-approvals/:id
   */
  async getApprovalById(userId: string, approvalId: string): Promise<any> {
    const approval = await this.prisma.registrationApproval.findUnique({
      where: { id: approvalId },
      include: {
        submission: {
          include: {
            tournament: true,
            team: {
              include: {
                captain: { select: { id: true, name: true } },
                members: {
                  include: {
                    user: { select: { id: true, name: true, profilePic: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!approval) {
      throw new NotFoundException({
        code: 'APPROVAL_NOT_FOUND',
        error_code: 'APPROVAL_NOT_FOUND',
        message: 'Approval not found',
      });
    }

    if (approval.userId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_APPROVER',
        error_code: 'NOT_APPROVER',
        message: 'You are not authorized to view this approval',
      });
    }

    const sub = approval.submission;
    const team = sub.team;
    const tournament = sub.tournament;

    const playingMembers = team.members.filter(
      (m) =>
        sub.playingUserIds.includes(m.userId) &&
        m.role !== TeamMemberRole.SUBSTITUTE &&
        m.role !== TeamMemberRole.MANAGER,
    );

    return {
      id: approval.id,
      status: approval.status,
      roster_version: sub.rosterVersion,
      created_at: approval.createdAt,
      responded_at: approval.respondedAt,
      tournament: {
        id: tournament.id,
        title: tournament.title,
        banner_url: tournament.bannerUrl,
        starts_at: tournament.startsAt,
      },
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag,
        logo_url: team.logoUrl,
      },
      responsible_person: {
        name: team.captain?.name || 'Leader',
        role: team.ownerRole === OwnerRole.MANAGER ? 'MANAGER' : 'LEADER',
      },
      playing_players: playingMembers.map((m) => ({
        user_id: m.userId,
        name: m.user?.name || 'Player',
        avatar: m.user?.profilePic || null,
        role: m.role,
      })),
    };
  }

  /**
   * POST /v1/registration-approvals/:id/approve
   */
  async approve(userId: string, approvalId: string): Promise<any> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const approval = await tx.registrationApproval.findUnique({
          where: { id: approvalId },
          include: {
            submission: {
              include: {
                approvals: true,
                tournament: true,
                team: {
                  include: {
                    members: true,
                  },
                },
              },
            },
          },
        });

        if (!approval) {
          throw new NotFoundException({
            code: 'APPROVAL_NOT_FOUND',
            error_code: 'APPROVAL_NOT_FOUND',
            message: 'Approval not found',
          });
        }

        if (approval.userId !== userId) {
          throw new ForbiddenException({
            code: 'NOT_APPROVER',
            error_code: 'NOT_APPROVER',
            message: 'You are not the designated approver for this request',
          });
        }

        if (approval.status !== RegistrationApprovalStatus.PENDING) {
          throw new BadRequestException({
            code: 'APPROVAL_NOT_PENDING',
            error_code: 'APPROVAL_NOT_PENDING',
            message: `Approval is already ${approval.status}`,
          });
        }

        const submission = approval.submission;
        const team = submission.team;
        const tournament = submission.tournament;

        if (submission.status !== RegistrationSubmissionStatus.ACTIVE) {
          throw new BadRequestException({
            code: 'REGISTRATION_NOT_PENDING',
            error_code: 'REGISTRATION_NOT_PENDING',
            message: 'Submission is no longer active',
          });
        }

        if (submission.rosterVersion !== team.rosterVersion) {
          throw new BadRequestException({
            code: 'ROSTER_VERSION_MISMATCH',
            error_code: 'ROSTER_VERSION_MISMATCH',
            message: 'Team roster has changed since this submission was created',
          });
        }

        if (team.registrationState !== TeamRegistrationState.PENDING_PLAYER_APPROVAL) {
          throw new BadRequestException({
            code: 'REGISTRATION_NOT_PENDING',
            error_code: 'REGISTRATION_NOT_PENDING',
            message: `Team registration is not pending player approval (current state: ${team.registrationState})`,
          });
        }

        if (tournament.status !== TournamentStatus.LIVE) {
          throw new BadRequestException({
            code: 'TOURNAMENT_NOT_LIVE',
            error_code: 'TOURNAMENT_NOT_LIVE',
            message: 'Tournament is not LIVE',
          });
        }

        const isPlayingMember =
          submission.playingUserIds.includes(userId) &&
          team.members.some(
            (m) =>
              m.userId === userId &&
              m.role !== TeamMemberRole.SUBSTITUTE &&
              m.role !== TeamMemberRole.MANAGER,
          );
        if (!isPlayingMember) {
          throw new BadRequestException({
            code: 'NOT_PLAYING_MEMBER',
            error_code: 'NOT_PLAYING_MEMBER',
            message: 'User is not currently an active player in the playing roster',
          });
        }

        // Mark APPROVED
        await tx.registrationApproval.update({
          where: { id: approvalId },
          data: {
            status: RegistrationApprovalStatus.APPROVED,
            respondedAt: new Date(),
          },
        });

        await tx.registrationEvent.create({
          data: {
            tournamentId: tournament.id,
            teamId: team.id,
            submissionId: submission.id,
            actorUserId: userId,
            eventType: 'APPROVAL_APPROVED',
            rosterVersion: team.rosterVersion,
            details: { approvalId },
          },
        });

        const otherApprovals = submission.approvals.filter((a) => a.id !== approvalId);
        const allApproved = otherApprovals.every(
          (a) => a.status === RegistrationApprovalStatus.APPROVED,
        );

        let finalizationResult: any = null;
        if (allApproved) {
          finalizationResult = await this.finalizeRegistration(
            tx,
            tournament.id,
            team.id,
            team.captainId,
            submission.id,
          );
        }

        return {
          allApproved,
          finalizationResult,
          team,
          tournament,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Emit approval response notification to owner
    this.events.emit('registration.approval_responded', {
      ownerUserId: result.team.captainId,
      tournamentId: result.tournament.id,
      teamId: result.team.id,
      action: 'approval_approved',
    });

    const finalState = result.allApproved
      ? result.finalizationResult?.status ?? 'CONFIRMED'
      : 'PENDING_PLAYER_APPROVAL';

    return {
      success: true,
      status: 'APPROVED',
      all_approved: result.allApproved,
      registration_state: finalState,
      slot_number: result.finalizationResult?.slotNumber ?? null,
    };
  }

  /**
   * POST /v1/registration-approvals/:id/decline
   */
  async decline(userId: string, approvalId: string): Promise<any> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const approval = await tx.registrationApproval.findUnique({
          where: { id: approvalId },
          include: {
            submission: {
              include: {
                tournament: true,
                team: {
                  include: { members: true },
                },
              },
            },
          },
        });

        if (!approval) {
          throw new NotFoundException({
            code: 'APPROVAL_NOT_FOUND',
            error_code: 'APPROVAL_NOT_FOUND',
            message: 'Approval not found',
          });
        }

        if (approval.userId !== userId) {
          throw new ForbiddenException({
            code: 'NOT_APPROVER',
            error_code: 'NOT_APPROVER',
            message: 'You are not the designated approver for this request',
          });
        }

        if (approval.status !== RegistrationApprovalStatus.PENDING) {
          throw new BadRequestException({
            code: 'APPROVAL_NOT_PENDING',
            error_code: 'APPROVAL_NOT_PENDING',
            message: `Approval is already ${approval.status}`,
          });
        }

        const submission = approval.submission;
        const team = submission.team;
        const tournament = submission.tournament;

        if (submission.status !== RegistrationSubmissionStatus.ACTIVE) {
          throw new BadRequestException({
            code: 'REGISTRATION_NOT_PENDING',
            error_code: 'REGISTRATION_NOT_PENDING',
            message: 'Submission is no longer active',
          });
        }

        if (submission.rosterVersion !== team.rosterVersion) {
          throw new BadRequestException({
            code: 'ROSTER_VERSION_MISMATCH',
            error_code: 'ROSTER_VERSION_MISMATCH',
            message: 'Team roster has changed since this submission was created',
          });
        }

        if (team.registrationState !== TeamRegistrationState.PENDING_PLAYER_APPROVAL) {
          throw new BadRequestException({
            code: 'REGISTRATION_NOT_PENDING',
            error_code: 'REGISTRATION_NOT_PENDING',
            message: `Team registration is not pending player approval (current state: ${team.registrationState})`,
          });
        }

        if (tournament.status !== TournamentStatus.LIVE) {
          throw new BadRequestException({
            code: 'TOURNAMENT_NOT_LIVE',
            error_code: 'TOURNAMENT_NOT_LIVE',
            message: 'Tournament is not LIVE',
          });
        }

        const isPlayingMember =
          submission.playingUserIds.includes(userId) &&
          team.members.some(
            (m) =>
              m.userId === userId &&
              m.role !== TeamMemberRole.SUBSTITUTE &&
              m.role !== TeamMemberRole.MANAGER,
          );
        if (!isPlayingMember) {
          throw new BadRequestException({
            code: 'NOT_PLAYING_MEMBER',
            error_code: 'NOT_PLAYING_MEMBER',
            message: 'User is not currently an active player in the playing roster',
          });
        }

        // Mark DECLINED
        await tx.registrationApproval.update({
          where: { id: approvalId },
          data: {
            status: RegistrationApprovalStatus.DECLINED,
            respondedAt: new Date(),
          },
        });

        // Set state = ROSTER_CHANGE_REQUIRED (submission stays ACTIVE for display)
        await tx.team.update({
          where: { id: team.id },
          data: {
            registrationState: TeamRegistrationState.ROSTER_CHANGE_REQUIRED,
          },
        });

        await tx.registrationEvent.create({
          data: {
            tournamentId: tournament.id,
            teamId: team.id,
            submissionId: submission.id,
            actorUserId: userId,
            eventType: 'APPROVAL_DECLINED',
            rosterVersion: team.rosterVersion,
            details: { approvalId },
          },
        });

        return { team, tournament };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Emit responses to owner
    this.events.emit('registration.approval_responded', {
      ownerUserId: result.team.captainId,
      tournamentId: result.tournament.id,
      teamId: result.team.id,
      action: 'approval_declined',
    });

    this.events.emit('registration.roster_change_required', {
      ownerUserId: result.team.captainId,
      tournamentId: result.tournament.id,
      teamId: result.team.id,
      teamName: result.team.name,
    });

    return {
      success: true,
      status: 'DECLINED',
      registration_state: TeamRegistrationState.ROSTER_CHANGE_REQUIRED,
    };
  }

  /**
   * POST /v1/tournaments/:id/teams/:teamId/registration/cancel-request
   */
  async cancelRegistrationRequest(
    userId: string,
    tournamentId: string,
    teamId: string,
  ): Promise<any> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          include: { members: true },
        });
        if (!team) {
          throw new NotFoundException('Team not found');
        }

        if (team.captainId !== userId) {
          throw new ForbiddenException({
            code: 'NOT_TEAM_OWNER',
            error_code: 'NOT_TEAM_OWNER',
            message: 'Only the team owner can cancel registration requests',
          });
        }

        if (
          team.registrationState !== TeamRegistrationState.PENDING_PLAYER_APPROVAL &&
          team.registrationState !== TeamRegistrationState.ROSTER_CHANGE_REQUIRED
        ) {
          throw new BadRequestException({
            code: 'REGISTRATION_NOT_PENDING',
            error_code: 'REGISTRATION_NOT_PENDING',
            message: 'There is no pending registration request to cancel',
          });
        }

        const activeSubmission = await tx.registrationSubmission.findFirst({
          where: {
            teamId,
            status: RegistrationSubmissionStatus.ACTIVE,
          },
          include: { approvals: true },
        });

        let pendingApproverIds: string[] = [];
        if (activeSubmission) {
          await tx.registrationSubmission.update({
            where: { id: activeSubmission.id },
            data: { status: RegistrationSubmissionStatus.CANCELLED },
          });

          pendingApproverIds = activeSubmission.approvals
            .filter((a) => a.status === RegistrationApprovalStatus.PENDING)
            .map((a) => a.userId);
        }

        await tx.team.update({
          where: { id: teamId },
          data: { registrationState: TeamRegistrationState.FORMING },
        });

        await tx.registrationEvent.create({
          data: {
            tournamentId,
            teamId,
            submissionId: activeSubmission?.id ?? null,
            actorUserId: userId,
            eventType: 'SUBMISSION_CANCELLED',
            rosterVersion: team.rosterVersion,
            details: { reason: 'Cancelled by owner' },
          },
        });

        return {
          team,
          pendingApproverIds,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const notifyUserIds = Array.from(
      new Set([...result.pendingApproverIds, result.team.captainId]),
    );
    if (notifyUserIds.length > 0) {
      this.events.emit('registration.invalidated', {
        userIds: notifyUserIds,
        tournamentId,
        teamId,
        teamName: result.team.name,
      });
    }

    return {
      success: true,
      message: 'Registration request cancelled',
      registration_state: TeamRegistrationState.FORMING,
    };
  }

  /**
   * Helper to construct the registration payload block for team responses
   */
  async getTeamRegistrationPayload(
    teamId: string,
    callerUserId?: string,
  ): Promise<{
    registration: any | null;
    my_pending_approval_id: string | null;
    can_cancel_registration_request: boolean;
  }> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        tournament: { select: { requirePlayerApproval: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, profilePic: true } },
          },
        },
      },
    });

    if (!team) {
      return {
        registration: null,
        my_pending_approval_id: null,
        can_cancel_registration_request: false,
      };
    }

    const isMember = callerUserId
      ? team.members.some((m) => m.userId === callerUserId)
      : false;

    if (!isMember) {
      return {
        registration: null,
        my_pending_approval_id: null,
        can_cancel_registration_request: false,
      };
    }

    const activeSubmission = await this.prisma.registrationSubmission.findFirst({
      where: {
        teamId,
        status: RegistrationSubmissionStatus.ACTIVE,
      },
      include: {
        approvals: true,
      },
    });

    const isOwner = callerUserId ? team.captainId === callerUserId : false;
    const canCancel = Boolean(
      isOwner &&
        (team.registrationState === TeamRegistrationState.PENDING_PLAYER_APPROVAL ||
          team.registrationState === TeamRegistrationState.ROSTER_CHANGE_REQUIRED),
    );

    let myPendingApprovalId: string | null = null;
    if (activeSubmission && callerUserId) {
      const myApproval = activeSubmission.approvals.find(
        (a) =>
          a.userId === callerUserId &&
          a.status === RegistrationApprovalStatus.PENDING,
      );
      if (myApproval) {
        myPendingApprovalId = myApproval.id;
      }
    }

    const requireApproval = team.tournament?.requirePlayerApproval ?? true;

    if (!activeSubmission) {
      // If no ACTIVE submission, return players list with NOT_REQUIRED
      const playingMembers = team.members.filter(
        (m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
      );

      const players = team.members.map((m) => {
        const isPlaying =
          m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER;
        return {
          user_id: m.userId,
          name: m.user?.name || 'Player',
          avatar: m.user?.profilePic || null,
          role: m.role,
          is_playing: isPlaying,
          approval_status: 'NOT_REQUIRED',
        };
      });

      return {
        registration: {
          submission_id: null,
          state: team.registrationState,
          roster_version: team.rosterVersion,
          require_player_approval: requireApproval,
          required_count: playingMembers.length,
          approved_count: 0,
          submitted_at: null,
          players,
        },
        my_pending_approval_id: null,
        can_cancel_registration_request: canCancel,
      };
    }

    const approvedCount = activeSubmission.approvals.filter(
      (a) => a.status === RegistrationApprovalStatus.APPROVED,
    ).length;

    const players = team.members.map((m) => {
      const isPlaying =
        activeSubmission.playingUserIds.includes(m.userId) &&
        m.role !== TeamMemberRole.SUBSTITUTE &&
        m.role !== TeamMemberRole.MANAGER;

      const approval = activeSubmission.approvals.find((a) => a.userId === m.userId);
      const approvalStatus = approval
        ? approval.status
        : 'NOT_REQUIRED';

      return {
        user_id: m.userId,
        name: m.user?.name || 'Player',
        avatar: m.user?.profilePic || null,
        role: m.role,
        is_playing: isPlaying,
        approval_status: approvalStatus,
      };
    });

    return {
      registration: {
        submission_id: activeSubmission.id,
        state: team.registrationState,
        roster_version: activeSubmission.rosterVersion,
        require_player_approval: requireApproval,
        required_count: activeSubmission.approvals.length,
        approved_count: approvedCount,
        submitted_at: activeSubmission.createdAt,
        players,
      },
      my_pending_approval_id: myPendingApprovalId,
      can_cancel_registration_request: canCancel,
    };
  }

  /**
   * Promotes the oldest waiting teams from the waitlist into open slots.
   * Only operates when tournament is LIVE.
   * In a transaction, while registered_count < max_slots and WAITING entries exist:
   *   - take the oldest entry (lock/claim it)
   *   - re-validate the team (scoped, roster size, profiles, ALREADY_IN_TOURNAMENT rules)
   *   - allocate lowest free slot with same conditional update as registration
   *   - create TournamentRegistration (CONFIRMED)
   *   - set team CONFIRMED, mark submission COMPLETED, mark entry PROMOTED, log event
   *   - if validation fails: mark entry INVALID with reason, set team FORMING, notify owner, continue with next entry
   * Emit tournament.waitlist_promoted with slot number for each promoted team.
   * Concurrency is safe: parallel promotions never promote the same entry or exceed max_slots.
   */
  async promoteFromWaitlist(tournamentId: string): Promise<{
    promotedCount: number;
    invalidatedCount: number;
  }> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, status: true, maxSlots: true, registeredCount: true, title: true, teamMode: true, gameId: true },
    });

    if (!tournament || tournament.status !== TournamentStatus.LIVE) {
      return { promotedCount: 0, invalidatedCount: 0 };
    }

    let promotedCount = 0;
    let invalidatedCount = 0;
    const toEmitPromoted: Array<{
      userIds: string[];
      teamId: string;
      tournamentId: string;
      tournamentTitle: string;
      slotNumber: number;
    }> = [];
    const toEmitInvalidated: Array<{
      ownerUserId: string;
      teamId: string;
      tournamentId: string;
      tournamentTitle: string;
      reason: string;
    }> = [];

    while (true) {
      const current = await this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { registeredCount: true, maxSlots: true, status: true },
      });
      if (!current || current.status !== TournamentStatus.LIVE || current.registeredCount >= current.maxSlots) {
        break;
      }

      const nextWaiting = await this.prisma.tournamentWaitlistEntry.findFirst({
        where: {
          tournamentId,
          status: WaitlistEntryStatus.WAITING,
        },
        orderBy: { createdAt: 'asc' },
        include: {
          team: {
            include: {
              captain: true,
              members: {
                include: { user: { include: { gameProfiles: true } } },
              },
              registrationSubmissions: {
                where: { status: RegistrationSubmissionStatus.ACTIVE },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      });

      if (!nextWaiting) break;

      const team = nextWaiting.team;
      let invalidReason: string | null = null;

      if (!team || team.tournamentId !== tournamentId) {
        invalidReason = 'Team is no longer scoped to this tournament';
      } else {
        const mainMembers = team.members.filter(
          (m) => m.role !== TeamMemberRole.SUBSTITUTE && m.role !== TeamMemberRole.MANAGER,
        );
        const participantUserIds = mainMembers.map((m) => m.userId);

        if (tournament.teamMode === TeamMode.DUO && mainMembers.length < 2) {
          invalidReason = 'Team does not meet minimum DUO roster requirements';
        } else if (tournament.teamMode === TeamMode.SQUAD && mainMembers.length !== 4) {
          invalidReason = 'Team must have exactly 4 main players for SQUAD tournament';
        } else {
          // Check profiles
          const profiles = await this.prisma.gameProfile.findMany({
            where: {
              gameId: tournament.gameId,
              userId: { in: participantUserIds },
            },
          });
          if (profiles.length < participantUserIds.length) {
            invalidReason = 'One or more team members missing required game profile';
          } else {
            // Check conflicts
            const conflictingReg = await this.prisma.tournamentRegistration.findFirst({
              where: {
                tournamentId,
                status: RegistrationStatus.CONFIRMED,
                teamId: { not: team.id },
                team: {
                  members: {
                    some: {
                      userId: { in: participantUserIds },
                      role: { not: TeamMemberRole.SUBSTITUTE },
                    },
                  },
                },
              },
            });
            if (conflictingReg) {
              invalidReason = 'One or more team members are already confirmed in another team';
            }
          }
        }
      }

      if (invalidReason) {
        await this.prisma.$transaction(async (tx) => {
          await tx.tournamentWaitlistEntry.update({
            where: { id: nextWaiting.id },
            data: {
              status: WaitlistEntryStatus.INVALID,
              reason: invalidReason,
              resolvedAt: new Date(),
            },
          });

          if (team) {
            await tx.team.update({
              where: { id: team.id },
              data: { registrationState: TeamRegistrationState.FORMING },
            });

            await tx.registrationSubmission.updateMany({
              where: { teamId: team.id, status: RegistrationSubmissionStatus.ACTIVE },
              data: { status: RegistrationSubmissionStatus.CANCELLED },
            });

            await tx.registrationEvent.create({
              data: {
                tournamentId,
                teamId: team.id,
                submissionId: team.registrationSubmissions?.[0]?.id ?? null,
                actorUserId: null,
                eventType: 'WAITLIST_INVALIDATED',
                rosterVersion: team.rosterVersion ?? 1,
                details: { reason: invalidReason },
              },
            });
          }
        });

        invalidatedCount++;
        if (team?.captainId) {
          toEmitInvalidated.push({
            ownerUserId: team.captainId,
            teamId: team.id,
            tournamentId,
            tournamentTitle: tournament.title,
            reason: invalidReason,
          });
        }
        continue;
      }

      // Valid team -> Promote atomically inside transaction
      const promotionResult = await this.prisma.$transaction(async (tx) => {
        const updateCount = await tx.tournament.updateMany({
          where: {
            id: tournamentId,
            status: TournamentStatus.LIVE,
            registeredCount: { lt: tournament.maxSlots },
          },
          data: {
            registeredCount: { increment: 1 },
          },
        });

        if (updateCount.count === 0) {
          return null;
        }

        const claimed = await tx.tournamentWaitlistEntry.updateMany({
          where: {
            id: nextWaiting.id,
            status: WaitlistEntryStatus.WAITING,
          },
          data: {
            status: WaitlistEntryStatus.PROMOTED,
            resolvedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          await tx.tournament.update({
            where: { id: tournamentId },
            data: { registeredCount: { decrement: 1 } },
          });
          return null;
        }

        const confirmedRegs = await tx.tournamentRegistration.findMany({
          where: {
            tournamentId,
            status: RegistrationStatus.CONFIRMED,
          },
          select: { slotNumber: true },
        });
        const usedSlots = new Set(confirmedRegs.map((r) => r.slotNumber));
        let slotNumber = 1;
        for (let s = 1; s <= tournament.maxSlots; s++) {
          if (!usedSlots.has(s)) {
            slotNumber = s;
            break;
          }
        }

        await tx.tournamentRegistration.create({
          data: {
            tournamentId,
            userId: team.captainId,
            teamId: team.id,
            status: RegistrationStatus.CONFIRMED,
            slotNumber,
          },
        });

        await tx.team.update({
          where: { id: team.id },
          data: { registrationState: TeamRegistrationState.CONFIRMED },
        });

        const activeSub = team.registrationSubmissions?.[0];
        if (activeSub) {
          await tx.registrationSubmission.update({
            where: { id: activeSub.id },
            data: {
              status: RegistrationSubmissionStatus.COMPLETED,
              completedAt: new Date(),
            },
          });
        }

        await tx.registrationEvent.create({
          data: {
            tournamentId,
            teamId: team.id,
            submissionId: activeSub?.id ?? null,
            actorUserId: null,
            eventType: 'WAITLIST_PROMOTED',
            rosterVersion: team.rosterVersion ?? 1,
            details: { slotNumber },
          },
        });

        return { slotNumber };
      });

      if (promotionResult) {
        promotedCount++;
        const allMemberUserIds = team.members.map((m) => m.userId);
        toEmitPromoted.push({
          userIds: allMemberUserIds,
          teamId: team.id,
          tournamentId,
          tournamentTitle: tournament.title,
          slotNumber: promotionResult.slotNumber,
        });
      }
    }

    for (const p of toEmitPromoted) {
      this.events.emit('tournament.waitlist_promoted', p);
    }
    for (const inv of toEmitInvalidated) {
      this.events.emit('tournament.waitlist_invalidated', inv);
    }

    return { promotedCount, invalidatedCount };
  }

  @OnEvent('tournament.slot_freed')
  async handleSlotFreed(payload: { tournamentId: string }): Promise<void> {
    await this.promoteFromWaitlist(payload.tournamentId);
  }

  async recountConfirmedRegistrations(tournamentId: string): Promise<number> {
    const count = await this.prisma.tournamentRegistration.count({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
      },
    });
    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { registeredCount: count },
    });
    return count;
  }
}
