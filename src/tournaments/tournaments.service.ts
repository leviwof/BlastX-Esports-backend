import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import {
  TournamentStatus,
  TeamMode,
  TournamentFormat,
  RegistrationStatus,
  Tournament,
  TournamentRegistration,
  Team,
  User,
} from '@prisma/client';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { FilterTournamentQueryDto } from './dto/filter-tournament.dto';
import { RegisterTournamentDto } from './dto/register-tournament.dto';
import { SetRoomCredentialsDto } from './dto/set-room.dto';
import { DisqualifyRegistrationDto } from './dto/disqualify.dto';
import { validateStatusTransition } from './tournament-state-machine';
import { PaginatedResult, createPaginatedResponse } from '../common/pagination.dto';

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

    const roomReleasedAt = dto.release_now ? new Date() : tournament.roomReleasedAt;

    const updated = await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        roomId: dto.room_id,
        roomPassword: dto.room_password,
        roomReleasedAt,
      },
    });

    if (dto.release_now) {
      this.eventEmitter.emit('room.released', {
        tournamentId,
        tournamentTitle: tournament.title,
        roomId: dto.room_id,
        roomPassword: dto.room_password,
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

  async getTournaments(dto: FilterTournamentQueryDto): Promise<PaginatedResult<Tournament & { game: { slug: string } }>> {
    const where: any = {};

    if (dto.status) where.status = dto.status;
    if (dto.team_mode) where.teamMode = dto.team_mode;
    if (dto.format) where.format = dto.format;
    if (dto.map) where.map = { contains: dto.map, mode: 'insensitive' };
    if (dto.date_from || dto.date_to) {
      where.startsAt = {};
      if (dto.date_from) where.startsAt.gte = new Date(dto.date_from);
      if (dto.date_to) where.startsAt.lte = new Date(dto.date_to);
    }

    const [items, total] = await Promise.all([
      this.prisma.tournament.findMany({
        where,
        include: { game: { select: { slug: true } } },
        orderBy: { startsAt: 'asc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.tournament.count({ where }),
    ]);

    return createPaginatedResponse(items, dto.page || 1, dto.limit || 20, total);
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

    if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
      throw new BadRequestException(`Tournament is not open for registration (status is ${tournament.status})`);
    }

    const now = new Date();
    if (now < tournament.registrationOpensAt || now > tournament.registrationClosesAt) {
      throw new BadRequestException('Tournament registration window is currently closed');
    }

    // Check Paid Tournaments feature flag
    if (tournament.entryFee > 0) {
      const paidEnabled = this.config.get<string>('PAID_TOURNAMENTS_ENABLED') === 'true';
      if (!paidEnabled) {
        throw new BadRequestException('Paid tournaments are not enabled yet');
      }
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
      if (team.gameId !== tournament.gameId) {
        throw new BadRequestException('Team is not configured for this game');
      }
      if (team.captainId !== userId) {
        throw new BadRequestException('Only the team captain can register the team for a tournament');
      }

      participantUserIds = team.members.map((m) => m.userId);

      // Roster size validation
      if (tournament.teamMode === TeamMode.DUO) {
        if (team.members.length < 2) {
          throw new BadRequestException('A DUO tournament requires a team with at least 2 players');
        }
      } else if (tournament.teamMode === TeamMode.SQUAD) {
        if (team.members.length < 4 || team.members.length > 5) {
          throw new BadRequestException('A SQUAD tournament requires exactly 4 players + optional 1 substitute (total 4 or 5 members)');
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
        const registeredUserIds = reg.team ? reg.team.members.map((m) => m.userId) : [reg.userId];
        const overlap = participantUserIds.some((uid) => registeredUserIds.includes(uid));
        if (overlap) {
          throw new BadRequestException('One or more of your team members are already registered in another team for this tournament');
        }
      }
    }

    // RACE-SAFE TRANSACTION: Atomic conditional slot increment
    return this.prisma.$transaction(async (tx) => {
      // Atomic increment conditional on registeredCount < maxSlots
      const updateResult = await tx.tournament.updateMany({
        where: {
          id: tournamentId,
          status: TournamentStatus.REGISTRATION_OPEN,
          registeredCount: { lt: tournament.maxSlots },
        },
        data: {
          registeredCount: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('Tournament registration is full or no longer open');
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

    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        userId,
        status: RegistrationStatus.CONFIRMED,
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

  async getRoomCredentials(userId: string, tournamentId: string): Promise<{ room_id: string; room_password: string; room_released_at: Date | null }> {
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
      throw new ForbiddenException('You must be registered in this tournament to view room details');
    }

    const now = new Date();
    const isReleased = tournament.roomReleasedAt && tournament.roomReleasedAt <= now;
    if (!isReleased || !tournament.roomId || !tournament.roomPassword) {
      throw new ForbiddenException('Room credentials have not been released yet for this tournament');
    }

    return {
      room_id: tournament.roomId,
      room_password: tournament.roomPassword,
      room_released_at: tournament.roomReleasedAt,
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

  private async getTournamentEntity(tournamentId: string): Promise<Tournament> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }
    return tournament;
  }
}
