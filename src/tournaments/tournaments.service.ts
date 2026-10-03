import {
  Injectable,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import {
  TournamentStatus,
  TeamMode,
  TournamentFormat,
  TournamentSection,
  RegistrationStatus,
  Tournament,
  TournamentRegistration,
  Team,
  TeamMember,
  TeamMemberRole,
  User,
} from '@prisma/client';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { FilterTournamentQueryDto } from './dto/filter-tournament.dto';
import { RegisterTournamentDto } from './dto/register-tournament.dto';
import { CreateTournamentTeamDto } from './dto/create-tournament-team.dto';
import { SetRoomCredentialsDto } from './dto/set-room.dto';
import { DisqualifyRegistrationDto } from './dto/disqualify.dto';
import { validateStatusTransition } from './tournament-state-machine';
import { PaginatedResult, createPaginatedResponse } from '../common/pagination.dto';
import { toTeamResponse } from '../teams/team.mapper';
import { TournamentBracketResponse, TournamentStage, StageTeam } from './tournament.mapper';
import { randomBytes } from 'crypto';

@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async createTournament(adminId: string, dto: CreateTournamentDto): Promise<Tournament> {
    const gameSlug = dto.game_slug || 'free_fire';
    const game = await this.prisma.game.findUnique({ where: { slug: gameSlug } });
    if (!game) {
      throw new BadRequestException(`Game '${gameSlug}' not found`);
    }

    const regOpen = new Date(dto.registration_opens_at);
    const regClose = new Date(dto.registration_closes_at);
    const startsAt = new Date(dto.starts_at);

    if (regOpen >= regClose) {
      throw new BadRequestException('registration_opens_at must be before registration_closes_at');
    }
    if (regClose >= startsAt) {
      throw new BadRequestException('registration_closes_at must be before starts_at');
    }

    const streamUrl = dto.stream_url || dto.streamUrl || null;
    const viewersCount = dto.viewers_count ?? dto.viewersCount ?? 0;
    const organizerName = dto.organizer_name || dto.organizer || null;
    const organizerVerified = dto.organizer_verified ?? dto.organizerVerified ?? false;

    return this.prisma.tournament.create({
      data: {
        gameId: game.id,
        title: dto.title,
        description: dto.description,
        bannerUrl: dto.banner_url,
        format: dto.format,
        teamMode: dto.team_mode,
        map: dto.map,
        maxSlots: dto.max_slots,
        entryFee: dto.entry_fee || 0,
        prizePool: dto.prize_pool || 0,
        prizeDistribution: dto.prize_distribution || null,
        rules: dto.rules || null,
        registrationOpensAt: regOpen,
        registrationClosesAt: regClose,
        startsAt,
        status: TournamentStatus.DRAFT,
        section: dto.section ?? TournamentSection.BLASTX,
        streamUrl,
        viewersCount,
        organizerName,
        organizerVerified,
        accentColorHex: dto.accent_color_hex || null,
        perKillReward: dto.per_kill_reward || 0,
        booyahBonus: dto.booyah_bonus || 0,
        pointsSystem: dto.points_system || null,
        schedule: dto.schedule || null,
        announcements: dto.announcements || null,
        createdBy: adminId,
      },
    });
  }

  async updateTournament(adminId: string, tournamentId: string, dto: UpdateTournamentDto): Promise<Tournament> {
    const tournament = await this.getTournamentEntity(tournamentId);

    const data: any = {};
    if (dto.title) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.banner_url !== undefined) data.bannerUrl = dto.banner_url;
    if (dto.format) data.format = dto.format;
    if (dto.team_mode) data.teamMode = dto.team_mode;
    if (dto.map) data.map = dto.map;
    if (dto.max_slots !== undefined) data.maxSlots = dto.max_slots;
    if (dto.entry_fee !== undefined) data.entryFee = dto.entry_fee;
    if (dto.prize_pool !== undefined) data.prizePool = dto.prize_pool;
    if (dto.prize_distribution !== undefined) data.prizeDistribution = dto.prize_distribution;
    if (dto.rules !== undefined) data.rules = dto.rules;
    if (dto.registration_opens_at) data.registrationOpensAt = new Date(dto.registration_opens_at);
    if (dto.registration_closes_at) data.registrationClosesAt = new Date(dto.registration_closes_at);
    if (dto.starts_at) data.startsAt = new Date(dto.starts_at);
    if (dto.stream_url !== undefined || dto.streamUrl !== undefined) data.streamUrl = dto.stream_url || dto.streamUrl || null;
    if (dto.viewers_count !== undefined || dto.viewersCount !== undefined) data.viewersCount = dto.viewers_count ?? dto.viewersCount;
    if (dto.organizer_name !== undefined || dto.organizer !== undefined) data.organizerName = dto.organizer_name || dto.organizer;
    if (dto.organizer_verified !== undefined || dto.organizerVerified !== undefined) data.organizerVerified = dto.organizer_verified ?? dto.organizerVerified;
    if (dto.accent_color_hex !== undefined) data.accentColorHex = dto.accent_color_hex;
    if (dto.per_kill_reward !== undefined) data.perKillReward = dto.per_kill_reward;
    if (dto.booyah_bonus !== undefined) data.booyahBonus = dto.booyah_bonus;
    if (dto.points_system !== undefined) data.pointsSystem = dto.points_system;
    if (dto.schedule !== undefined) data.schedule = dto.schedule;
    if (dto.announcements !== undefined) data.announcements = dto.announcements;
    if (dto.section !== undefined) data.section = dto.section;

    return this.prisma.tournament.update({
      where: { id: tournamentId },
      data,
    });
  }

  async updateStatus(adminId: string, tournamentId: string, newStatus: TournamentStatus): Promise<Tournament> {
    const tournament = await this.getTournamentEntity(tournamentId);
    validateStatusTransition(tournament.status, newStatus);

    const updated = await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: newStatus },
    });

    this.eventEmitter.emit('status.changed', {
      tournamentId,
      oldStatus: tournament.status,
      newStatus,
    });

    return updated;
  }

  async setRoomCredentials(adminId: string, tournamentId: string, dto: SetRoomCredentialsDto): Promise<Tournament> {
    const tournament = await this.getTournamentEntity(tournamentId);
    const roomPassword = dto.password ?? dto.room_password;
    if (!roomPassword) {
      throw new BadRequestException('A room password is required');
    }

    const roomReleasedAt = dto.release_now ? new Date() : tournament.roomReleasedAt;

    const updated = await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        roomId: dto.room_id,
        roomPassword,
        roomReleasedAt,
      },
    });

    if (dto.release_now) {
      this.eventEmitter.emit('room.released', {
        tournamentId,
        tournamentTitle: tournament.title,
        roomId: dto.room_id,
        roomPassword,
      });
    }

    return updated;
  }

  async disqualifyRegistration(adminId: string, tournamentId: string, dto: DisqualifyRegistrationDto): Promise<TournamentRegistration> {
    const registration = await this.prisma.tournamentRegistration.findUnique({
      where: { id: dto.registration_id },
    });

    if (!registration || registration.tournamentId !== tournamentId) {
      throw new NotFoundException('Registration record not found for this tournament');
    }

    return this.prisma.tournamentRegistration.update({
      where: { id: dto.registration_id },
      data: { status: RegistrationStatus.DISQUALIFIED },
    });
  }

  /**
   * Public statuses that may appear in the listing.
   * DRAFT and CANCELLED are never shown to regular users.
   */
  private static readonly PUBLIC_STATUSES: TournamentStatus[] = [
    TournamentStatus.UPCOMING,
    TournamentStatus.REGISTRATION_OPEN,
    TournamentStatus.REGISTRATION_CLOSED,
    TournamentStatus.LIVE,
    TournamentStatus.COMPLETED,
  ];

  /**
   * When the Flutter app sends status=UPCOMING it means "all pre-game
   * tournaments" — i.e., UPCOMING + REGISTRATION_OPEN + REGISTRATION_CLOSED.
   */
  private static readonly UPCOMING_STATUSES: TournamentStatus[] = [
    TournamentStatus.UPCOMING,
    TournamentStatus.REGISTRATION_OPEN,
    TournamentStatus.REGISTRATION_CLOSED,
  ];

  async getTournaments(
    dto: FilterTournamentQueryDto,
    requiredSection?: TournamentSection,
    includeNonPublic = false,
  ): Promise<PaginatedResult<Tournament & { game: { slug: string } }> & { counts: { live: number; upcoming: number; completed: number } }> {
    // Player-facing lists hide drafts/cancelled events; the admin catalogue
    // includes them so a new DRAFT can immediately be edited or published.
    const where: any = includeNonPublic
      ? {}
      : { status: { in: TournamentsService.PUBLIC_STATUSES } };

    // Status filter — expand UPCOMING to its three constituent statuses
    if (dto.status) {
      const s = dto.status.toUpperCase();
      if (s === 'UPCOMING') {
        where.status = { in: TournamentsService.UPCOMING_STATUSES };
      } else if (s === 'LIVE') {
        where.status = TournamentStatus.LIVE;
      } else if (s === 'COMPLETED') {
        where.status = TournamentStatus.COMPLETED;
      } else if (includeNonPublic && Object.values(TournamentStatus).includes(s as TournamentStatus)) {
        where.status = s as TournamentStatus;
      } else {
        // Unknown status — keep the public filter (don't return an error;
        // the app may send other values in future).
        where.status = { in: TournamentsService.PUBLIC_STATUSES };
      }
    }

    if (dto.team_mode) where.teamMode = dto.team_mode;
    // The two app experiences are intentionally separate catalogs.  The
    // general tournament endpoint must never leak Free Fire Live events.
    where.section = requiredSection ?? dto.section ?? TournamentSection.BLASTX;
    if (dto.format) where.format = dto.format;
    if (dto.map) where.map = { contains: dto.map, mode: 'insensitive' };

    // Game filter
    if (dto.game || dto.game_slug) {
      const g = (dto.game_slug || dto.game)!.trim();
      where.game = {
        OR: [
          { slug: { equals: g, mode: 'insensitive' } },
          { name: { equals: g, mode: 'insensitive' } },
          { name: { contains: g, mode: 'insensitive' } },
        ],
      };
    }

    // Full-text search (title + organizer name)
    if (dto.q && dto.q.trim()) {
      const term = dto.q.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { organizerName: { contains: term, mode: 'insensitive' } },
        { map: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (dto.date_from || dto.date_to) {
      where.startsAt = {};
      if (dto.date_from) where.startsAt.gte = new Date(dto.date_from);
      if (dto.date_to) where.startsAt.lte = new Date(dto.date_to);
    }

    // Counts query: game filter only (independent of status/q so chip badges
    // show totals for the full game, not just the current filtered subset).
    const countsWhere: any = { status: { in: TournamentsService.PUBLIC_STATUSES } };
    if (where.game) countsWhere.game = where.game;
    countsWhere.section = requiredSection ?? dto.section ?? TournamentSection.BLASTX;

    const [items, total, liveCount, upcomingCount, completedCount] = await Promise.all([
      this.prisma.tournament.findMany({
        where,
        include: { game: { select: { slug: true } } },
        orderBy: { startsAt: 'asc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.tournament.count({ where }),
      this.prisma.tournament.count({ where: { ...countsWhere, status: TournamentStatus.LIVE } }),
      this.prisma.tournament.count({ where: { ...countsWhere, status: { in: TournamentsService.UPCOMING_STATUSES } } }),
      this.prisma.tournament.count({ where: { ...countsWhere, status: TournamentStatus.COMPLETED } }),
    ]);

    return {
      ...createPaginatedResponse(items, dto.page || 1, dto.limit || 20, total),
      counts: {
        live: liveCount,
        upcoming: upcomingCount,
        completed: completedCount,
      },
    };
  }


  async getTournamentById(tournamentId: string, currentUserId?: string): Promise<Tournament & { game: { slug: string }; registrations?: TournamentRegistration[] }> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        game: { select: { slug: true } },
        registrations: currentUserId
          ? {
              where: {
                status: RegistrationStatus.CONFIRMED,
              },
            }
          : false,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return tournament as any;
  }

  async getMyTournaments(userId: string): Promise<Tournament[]> {
    // User can be registered directly OR via a team
    const userTeams = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = userTeams.map((t) => t.teamId);

    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        status: RegistrationStatus.CONFIRMED,
        OR: [{ userId }, ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : [])],
      },
      select: { tournamentId: true },
    });

    const tournamentIds = Array.from(new Set(registrations.map((r) => r.tournamentId)));

    return this.prisma.tournament.findMany({
      where: { id: { in: tournamentIds } },
      include: { game: { select: { slug: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async registerUserOrTeam(userId: string, tournamentId: string, dto: RegisterTournamentDto): Promise<TournamentRegistration> {
    const tournament = await this.getTournamentEntity(tournamentId);

    if (tournament.status !== TournamentStatus.LIVE) {
      throw new BadRequestException(
        `Registration opens only when the tournament is LIVE (current status: ${tournament.status})`,
      );
    }

    // Check Paid Tournaments feature flag
    if (tournament.entryFee > 0) {
      const paidEnabled = this.config.get<string>('PAID_TOURNAMENTS_ENABLED') === 'true';
      throw new BadRequestException({
        code: 'PAID_TOURNAMENTS_UNAVAILABLE',
        message: paidEnabled
          ? 'Paid tournaments require wallet support and are not available yet'
          : 'Paid tournaments are not enabled yet',
      });
    }

    let teamId: string | null = null;
    let participantUserIds: string[] = [];

    if (tournament.teamMode === TeamMode.SOLO) {
      // SOLO mode
      participantUserIds = [userId];

      // Must have Free Fire Game Profile
      const profile = await this.prisma.gameProfile.findUnique({
        where: { unique_user_game: { userId, gameId: tournament.gameId } },
      });
      if (!profile) {
        throw new BadRequestException('You must set up your Free Fire game profile before registering for a tournament');
      }
    } else {
      // DUO or SQUAD mode
      if (!dto.team_id) {
        throw new BadRequestException(`A team_id is required for ${tournament.teamMode} tournaments`);
      }
      teamId = dto.team_id;

      const team = await this.prisma.team.findUnique({
        where: { id: teamId },
        include: { members: true },
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
        throw new BadRequestException('Only the team captain can register the team for a tournament');
      }

      const mainMembers = team.members.filter((member) => member.role !== TeamMemberRole.SUBSTITUTE);
      participantUserIds = mainMembers.map((member) => member.userId);

      // Roster size validation
      if (tournament.teamMode === TeamMode.DUO) {
        if (mainMembers.length < 2) {
          throw new BadRequestException('A DUO tournament requires a team with at least 2 players');
        }
      } else if (tournament.teamMode === TeamMode.SQUAD) {
        if (mainMembers.length !== 4) {
          throw new BadRequestException({
            status: 'error',
            code: 'INVALID_MEMBER_COUNT',
            message: 'Tournament registration requires exactly 4 main players in your team.',
          });
        }
      }

      // Check EVERY member has a Free Fire game profile
      const profiles = await this.prisma.gameProfile.findMany({
        where: {
          gameId: tournament.gameId,
          userId: { in: participantUserIds },
        },
      });
      if (profiles.length < participantUserIds.length) {
        throw new BadRequestException('All team members must set up a Free Fire game profile before joining');
      }
    }

    // Check if user/team is already registered or if any team member is registered in another team in this tournament
    const existingRegistrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
      },
      include: { team: { include: { members: true } } },
    });

    for (const reg of existingRegistrations) {
      if (tournament.teamMode === TeamMode.SOLO) {
        if (reg.userId === userId) {
          throw new BadRequestException('You are already registered in this tournament');
        }
      } else {
        if (reg.teamId === teamId) {
          throw new BadRequestException('Your team is already registered in this tournament');
        }
        // Check if any player in the registering team is in an already-registered team
        const registeredUserIds = reg.team
          ? reg.team.members
              .filter((member) => member.role !== TeamMemberRole.SUBSTITUTE)
              .map((member) => member.userId)
          : [reg.userId];
        const overlap = participantUserIds.some((uid) => registeredUserIds.includes(uid));
        if (overlap) {
          throw new BadRequestException('One or more of your team members are already registered in another team for this tournament');
        }
      }

    }

    if (teamId) {
      const formingTeamConflict = await this.prisma.team.findFirst({
        where: {
          tournamentId,
          id: { not: teamId },
          members: { some: { userId: { in: participantUserIds } } },
        },
        select: { id: true },
      });
      if (formingTeamConflict) {
        throw new BadRequestException(
          'One or more team members already belong to another team for this tournament',
        );
      }
    }

    // RACE-SAFE TRANSACTION: Atomic conditional slot increment
    return this.prisma.$transaction(async (tx) => {
      // Atomic increment conditional on registeredCount < maxSlots
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

      if (updateResult.count === 0) {
        throw new BadRequestException('Tournament registration is full or is no longer LIVE');
      }

      // Read updated registered count to assign slot number
      const updatedTourney = await tx.tournament.findUnique({
        where: { id: tournamentId },
        select: { registeredCount: true },
      });
      const slotNumber = updatedTourney?.registeredCount || 1;

      // PHASE 3 HOOK: Wallet debit integration
      if (tournament.entryFee > 0) {
        // walletService.debit(userId, tournament.entryFee, ...)
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

      this.eventEmitter.emit('registration.confirmed', {
        userId,
        tournamentId,
        tournamentTitle: tournament.title,
        slotNumber,
      });

      return registration;
    });
  }

  async unregisterUserOrTeam(userId: string, tournamentId: string): Promise<{ message: string }> {
    const tournament = await this.getTournamentEntity(tournamentId);

    const now = new Date();
    if (now > tournament.registrationClosesAt) {
      throw new BadRequestException('Cannot unregister after registration window has closed');
    }

    const userTeams = await this.prisma.teamMember.findMany({
      where: { userId, role: TeamMemberRole.CAPTAIN },
      select: { teamId: true },
    });
    const captainTeamIds = userTeams.map((t) => t.teamId);

    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
        OR: [
          { userId },
          ...(captainTeamIds.length > 0 ? [{ teamId: { in: captainTeamIds } }] : []),
        ],
      },
    });

    if (!registration) {
      throw new NotFoundException('You do not have an active confirmed registration for this tournament');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.tournamentRegistration.update({
        where: { id: registration.id },
        data: { status: RegistrationStatus.CANCELLED },
      });

      await tx.tournament.update({
        where: { id: tournamentId },
        data: { registeredCount: { decrement: 1 } },
      });

      // PHASE 3 HOOK: Refund entry fee if paid
      if (tournament.entryFee > 0) {
        // walletService.credit(userId, tournament.entryFee, ...)
      }

      return { message: 'Successfully unregistered from tournament' };
    });
  }

  async getRoomCredentials(
    userId: string,
    tournamentId: string,
  ): Promise<{ room_id: string; room_password: string; visibleFrom: Date; starts_at: Date }> {
    const tournament = await this.getTournamentEntity(tournamentId);

    // Check if user is registered directly or through a team
    const userTeams = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = userTeams.map((t) => t.teamId);

    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
        OR: [{ userId }, ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : [])],
      },
    });

    if (!registration) {
      throw new HttpException(
        { code: 'NOT_REGISTERED', message: 'You are not registered for this tournament.' },
        HttpStatus.FORBIDDEN,
      );
    }

    const now = new Date();
    const revealAt = tournament.roomReleasedAt ?? new Date(tournament.startsAt.getTime() - 15 * 60 * 1000);
    const isReleased = revealAt <= now;
    if (!isReleased || !tournament.roomId || !tournament.roomPassword) {
      throw new HttpException(
        {
          code: 'ROOM_NOT_AVAILABLE',
          message: 'Room details will be released 15 minutes before match start.',
          reveal_at: revealAt.toISOString(),
        },
        425,
      );
    }

    return {
      room_id: tournament.roomId,
      room_password: tournament.roomPassword,
      visibleFrom: revealAt,
      starts_at: tournament.startsAt,
    };
  }

  async getParticipants(tournamentId: string): Promise<TournamentRegistration[]> {
    return this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
      },
      include: {
        user: { select: { id: true, name: true, email: true, profilePic: true } },
        team: { include: { members: { include: { user: { select: { id: true, name: true } } } } } },
      },
      orderBy: { slotNumber: 'asc' },
    });
  }

  /**
   * Returns a read-only list of teams registered in the tournament.
   * Used by the Teams tab in the Live section.
   * Solo registrations (teamId = null) are excluded.
   */
  async getTeamsForTournament(tournamentId: string) {
    await this.getTournamentEntity(tournamentId);

    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
        teamId: { not: null },
      },
      include: {
        team: {
          include: {
            captain: { select: { id: true, name: true } },
            members: true,
          },
        },
      },
      orderBy: { slotNumber: 'asc' },
    });

    return registrations
      .filter((r) => r.team !== null)
      .map((r) => {
        const team = r.team!;
        let status: 'active' | 'eliminated' | 'qualified' = 'active';
        if (r.finalRank !== null && r.finalRank !== undefined) {
          status = r.finalRank === 1 ? 'qualified' : 'eliminated';
        }
        return {
          id: team.id,
          name: team.name,
          tag: team.tag,
          logo_url: team.logoUrl ?? null,
          captain_name: team.captain?.name ?? null,
          players_count: team.members.length,
          slot_number: r.slotNumber,
          final_rank: r.finalRank ?? null,
          status,
        };
      });
  }

  async getRegisteredTeamsForTournament(tournamentId: string) {
    await this.getTournamentEntity(tournamentId);
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
        teamId: { not: null },
      },
      include: {
        team: {
          include: {
            captain: { select: { name: true } },
            members: true,
          },
        },
      },
      orderBy: { slotNumber: 'asc' },
    });

    return registrations.flatMap((registration) => {
      if (!registration.team) return [];
      const mainMembers = registration.team.members.filter(
        (member) => member.role !== TeamMemberRole.SUBSTITUTE,
      );
      return [{
        id: registration.team.id,
        name: registration.team.name,
        tag: registration.team.tag,
        logo_url: registration.team.logoUrl ?? '',
        captain_name: registration.team.captain.name,
        member_count: mainMembers.length,
        registered_at: registration.createdAt,
      }];
    });
  }

  private async getTournamentEntity(tournamentId: string): Promise<Tournament> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }
    return tournament;
  }

  async getMyTeamForTournament(userId: string, tournamentId: string) {
    await this.getTournamentEntity(tournamentId);

    const formingTeam = await this.prisma.team.findFirst({
      where: {
        tournamentId,
        members: { some: { userId } },
      },
      include: {
        captain: true,
        members: {
          include: {
            user: { include: { gameProfiles: true } },
          },
        },
      },
    });
    if (formingTeam) {
      const registration = await this.prisma.tournamentRegistration.findUnique({
        where: {
          unique_tournament_team: { tournamentId, teamId: formingTeam.id },
        },
      });
      return {
        ...toTeamResponse(formingTeam as any),
        tournament_id: tournamentId,
        is_registered: registration?.status === RegistrationStatus.CONFIRMED,
        slot_number: registration?.slotNumber ?? null,
        registration_status: registration?.status ?? null,
      };
    }

    const userMemberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = userMemberships.map((m) => m.teamId);

    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
        OR: [
          { userId, teamId: { not: null } },
          ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
        ],
      },
      include: {
        team: {
          include: {
            captain: true,
            members: {
              include: {
                user: {
                  include: { gameProfiles: true },
                },
              },
            },
          },
        },
      },
    });

    if (!registration || !registration.team) {
      return null;
    }

    return {
      ...toTeamResponse(registration.team as any),
      tournament_id: tournamentId,
      slot_number: registration.slotNumber,
      registration_status: registration.status,
    };
  }

  async createTournamentTeam(userId: string, tournamentId: string, dto: CreateTournamentTeamDto) {
    const cleanName = dto.name.trim();
    const cleanTag = dto.tag.trim().toUpperCase();
    const rawLogo = dto.logo_url ?? dto.logoUrl;
    const sanitizedLogoUrl = rawLogo && rawLogo.trim().length > 0 ? rawLogo.trim() : null;

    const [tournament, existingName] = await Promise.all([
      this.getTournamentEntity(tournamentId),
      this.prisma.team.findFirst({
        where: {
          game: { tournaments: { some: { id: tournamentId } } },
          name: { equals: cleanName, mode: 'insensitive' },
        },
      }),
    ]);

    if (
      tournament.status === TournamentStatus.DRAFT ||
      tournament.status === TournamentStatus.CANCELLED ||
      tournament.status === TournamentStatus.COMPLETED
    ) {
      throw new BadRequestException(`Cannot create a team for a tournament with status ${tournament.status}`);
    }

    if (existingName) {
      throw new BadRequestException(`Team name '${cleanName}' is already taken for this game`);
    }

    const existingTournamentMembership = await this.prisma.teamMember.findFirst({
      where: {
        userId,
        team: { tournamentId },
      },
      select: { id: true },
    });
    if (existingTournamentMembership) {
      throw new BadRequestException('You are already a member of a team for this tournament');
    }

    // Must have Game Profile for tournament's game
    let profile = await this.prisma.gameProfile.findUnique({
      where: { unique_user_game: { userId, gameId: tournament.gameId } },
    });
    if (!profile && dto.player?.uid && dto.player?.ign) {
      profile = await this.prisma.gameProfile.upsert({
        where: { unique_user_game: { userId, gameId: tournament.gameId } },
        update: {
          inGameUid: dto.player.uid.trim(),
          inGameName: dto.player.ign.trim(),
        },
        create: {
          userId,
          gameId: tournament.gameId,
          inGameUid: dto.player.uid.trim(),
          inGameName: dto.player.ign.trim(),
        },
      });
    }
    if (!profile) {
      throw new BadRequestException('You must set up your Free Fire game profile before creating a team');
    }

    let inviteCode = randomBytes(4).toString('hex').toUpperCase();
    while (await this.prisma.team.findUnique({ where: { inviteCode } })) {
      inviteCode = randomBytes(4).toString('hex').toUpperCase();
    }

    const team = await this.prisma.team.create({
      data: {
        gameId: tournament.gameId,
        tournamentId,
        name: cleanName,
        tag: cleanTag,
        logoUrl: sanitizedLogoUrl,
        acceptingSubstitutes: dto.accepting_substitutes ?? true,
        captainId: userId,
        inviteCode,
        members: {
          create: {
            userId,
            role: TeamMemberRole.CAPTAIN,
          },
        },
      },
      include: {
        captain: true,
        members: {
          include: {
            user: {
              include: { gameProfiles: true },
            },
          },
        },
      },
    });

    return {
      ...toTeamResponse(team as any),
      tournament_id: tournamentId,
      is_registered: false,
      is_registered_in_tournament: false,
      slot_number: null,
      registration_status: null,
    };
  }

  async previewTeamByCode(tournamentId: string, inviteCode: string, currentUserId?: string) {
    const tournament = await this.getTournamentEntity(tournamentId);

    const team = await this.prisma.team.findFirst({
      where: {
        inviteCode: { equals: inviteCode, mode: 'insensitive' },
        gameId: tournament.gameId,
        OR: [{ tournamentId }, { tournamentId: null }],
      },
      include: {
        captain: true,
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
      throw new NotFoundException('No team found matching this invite code for this tournament');
    }

    const registration = await this.prisma.tournamentRegistration.findUnique({
      where: {
        unique_tournament_team: {
          tournamentId,
          teamId: team.id,
        },
      },
    });

    const mainCount = team.members.filter((m) => m.role !== TeamMemberRole.SUBSTITUTE).length;
    const subCount = team.members.filter((m) => m.role === TeamMemberRole.SUBSTITUTE).length;
    const maxMain = tournament.teamMode === TeamMode.DUO ? 2 : 4;
    const maxSub = 1;

    const isAlreadyMember = currentUserId ? team.members.some((m) => m.userId === currentUserId) : false;
    const isRegistered = registration?.status === RegistrationStatus.CONFIRMED;
    const otherTournamentMembership = currentUserId
      ? await this.prisma.teamMember.findFirst({
          where: {
            userId: currentUserId,
            team: { tournamentId },
          },
          select: { teamId: true },
        })
      : null;
    const isOnAnotherTeam =
      !!otherTournamentMembership && otherTournamentMembership.teamId !== team.id;
    const canJoinMain = mainCount < maxMain && !isAlreadyMember && !isOnAnotherTeam && !isRegistered;
    const canJoinSub =
      (team.acceptingSubstitutes ?? true) &&
      subCount < maxSub &&
      !isAlreadyMember &&
      !isOnAnotherTeam &&
      !isRegistered;
    const isFull = !canJoinMain && !canJoinSub;

    return {
      ...toTeamResponse(team as any),
      tournament_id: tournamentId,
      captain_name: team.captain.name,
      is_registered_in_tournament: isRegistered,
      slot_number: registration?.slotNumber ?? null,
      roster_info: {
        main_players_count: mainCount,
        max_main_players: maxMain,
        substitute_count: subCount,
        max_substitutes: maxSub,
        accepting_substitutes: team.acceptingSubstitutes ?? true,
        is_already_member: isAlreadyMember,
        is_on_another_team: isOnAnotherTeam,
        can_join_main: canJoinMain,
        can_join_substitute: canJoinSub,
        is_full: isFull,
      },
      main_count: mainCount,
      max_main: maxMain,
      is_main_full: mainCount >= maxMain,
      can_join: !isAlreadyMember && !isFull,
    };
  }

  async getTournamentBracket(tournamentId: string): Promise<TournamentBracketResponse> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        matches: {
          include: {
            results: {
              include: {
                registration: {
                  include: { team: true, user: true },
                },
              },
            },
          },
          orderBy: { matchNumber: 'asc' },
        },
        registrations: {
          where: { status: RegistrationStatus.CONFIRMED },
          include: { team: true, user: true, matchResults: true },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    // 1. If explicit bracket / stages is defined in tournament rules (e.g. rules.stages or rules.bracket)
    const rulesObj = tournament.rules as any;
    if (rulesObj?.stages && Array.isArray(rulesObj.stages)) {
      return {
        id: tournament.id,
        title: tournament.title,
        status: tournament.status,
        stages: rulesObj.stages,
      };
    }

    // 2. Generate standard stages dynamically:
    const confirmedRegs = tournament.registrations;

    // Calculate score per registration
    const teamEntries = confirmedRegs.map((reg) => {
      const points = reg.matchResults.reduce((acc, r) => acc + r.totalPoints, 0);
      const kills = reg.matchResults.reduce((acc, r) => acc + r.kills, 0);
      const booyahs = reg.matchResults.filter((r) => r.placement === 1).length;
      const lastPlacement = reg.matchResults.length > 0 ? reg.matchResults[reg.matchResults.length - 1].placement : 999;
      const teamId = reg.teamId || reg.userId;
      const teamName = reg.team?.name || reg.user.name;
      const logoUrl = reg.team?.logoUrl || reg.user.profilePic || null;

      return {
        id: teamId,
        name: teamName,
        logo_url: logoUrl,
        points,
        kills,
        booyahs,
        lastPlacement,
      };
    });

    // Sort by tie-breaker: points desc, booyahs desc, kills desc, lastPlacement asc
    teamEntries.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.booyahs !== a.booyahs) return b.booyahs - a.booyahs;
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.lastPlacement - b.lastPlacement;
    });

    const isCompleted = tournament.status === TournamentStatus.COMPLETED;
    const isLive = tournament.status === TournamentStatus.LIVE;

    // Cut-off for qualification to finals: half of maxSlots or top 12
    const totalTeams = teamEntries.length;
    const qualifyCutoff = Math.max(1, Math.min(12, Math.ceil(totalTeams / 2)));

    // Stage 1 teams:
    const stage1Teams: StageTeam[] = teamEntries.map((t, idx) => {
      const rank = idx + 1;
      const isQualified = (isLive || isCompleted) && totalTeams > 1 ? rank <= qualifyCutoff : false;
      const isEliminated = (isLive || isCompleted) && totalTeams > 1 ? rank > qualifyCutoff : false;
      return {
        id: t.id,
        name: t.name,
        logo_url: t.logo_url,
        points: t.points,
        kills: t.kills,
        rank,
        is_eliminated: isEliminated,
        is_qualified: isQualified,
        is_winner: false,
      };
    });

    // Stage 2 teams: only qualified teams if tournament is live or completed
    const stage2Source = (isLive || isCompleted) && totalTeams > 1
      ? teamEntries.slice(0, qualifyCutoff)
      : teamEntries;

    const stage2Teams: StageTeam[] = stage2Source.map((t, idx) => {
      const rank = idx + 1;
      return {
        id: t.id,
        name: t.name,
        logo_url: t.logo_url,
        points: isCompleted || isLive ? t.points : 0,
        kills: isCompleted || isLive ? t.kills : 0,
        rank,
        is_eliminated: isCompleted ? rank > 1 : false,
        is_qualified: isCompleted ? false : isLive,
        is_winner: isCompleted && rank === 1,
      };
    });

    const stages: TournamentStage[] = [
      {
        stage_id: 'stage_1',
        stage_name: 'Round 1 (Qualifiers)',
        stage_number: 1,
        is_current: !isCompleted && (!isLive || stage1Teams.some((t) => !t.is_qualified && !t.is_eliminated)),
        is_completed: isCompleted || (isLive && stage1Teams.some((t) => t.is_qualified)),
        teams: stage1Teams,
      },
      {
        stage_id: 'stage_2',
        stage_name: 'Grand Finals',
        stage_number: 2,
        is_current: isLive && stage1Teams.some((t) => t.is_qualified),
        is_completed: isCompleted,
        teams: stage2Teams,
      },
    ];

    return {
      id: tournament.id,
      title: tournament.title,
      status: tournament.status,
      stages,
    };
  }
}
