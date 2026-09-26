import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, User, GameProfile, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertGameProfileDto } from './dto/upsert-game-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { toUserResponse, UserResponse, UserGameProfileSummary } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getProfileWithStats(userId: string): Promise<UserResponse | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        gameProfiles: {
          include: {
            game: { select: { slug: true, name: true } },
          },
        },
      },
    });

    if (!user) return null;

    // 1. Get user's team memberships
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const userTeamIds = memberships.map((m) => m.teamId);

    // 2. Fetch registrations the user participated in (solo or via team)
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        status: RegistrationStatus.CONFIRMED,
        OR: [
          { userId },
          ...(userTeamIds.length > 0 ? [{ teamId: { in: userTeamIds } }] : []),
        ],
      },
      select: {
        id: true,
        finalRank: true,
        tournamentId: true,
      },
    });

    // Unique tournament registrations
    const uniqueRegistrations = Array.from(
      new Map(registrations.map((r) => [r.id, r])).values(),
    );

    const tournamentsPlayed = uniqueRegistrations.length;
    const tournamentsWon = uniqueRegistrations.filter((r) => r.finalRank === 1).length;

    // 3. Calculate Total Kills from MatchResult across these registrations
    const regIds = uniqueRegistrations.map((r) => r.id);
    let totalKills = 0;
    if (regIds.length > 0) {
      const killAgg = await this.prisma.matchResult.aggregate({
        where: { registrationId: { in: regIds } },
        _sum: { kills: true },
      });
      totalKills = killAgg._sum.kills || 0;
    }

    // 4. Calculate Win Rate %
    const winRateVal = tournamentsPlayed > 0
      ? ((tournamentsWon / tournamentsPlayed) * 100).toFixed(1)
      : '0.0';

    // 5. Embedded Game Profile (prefer Free Fire)
    const ffProfile =
      user.gameProfiles.find((gp) => gp.game?.slug === 'free_fire') ||
      user.gameProfiles[0] ||
      null;

    const gameProfile: UserGameProfileSummary | null = ffProfile
      ? {
          id: ffProfile.id,
          game_slug: ffProfile.game?.slug || 'free_fire',
          game_name: ffProfile.game?.name || 'Free Fire',
          in_game_uid: ffProfile.inGameUid,
          in_game_name: ffProfile.inGameName,
        }
      : null;

    return toUserResponse(user, undefined, {
      tournaments_played: tournamentsPlayed,
      tournaments_won: tournamentsWon,
      total_kills: totalKills,
      win_rate: `${winRateVal}%`,
      xp: (user as any).xp ?? 0,
      rank: (user as any).rank ?? 0,
      game_profile: gameProfile,
    });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async updateUserProfile(userId: string, dto: UpdateUserDto): Promise<User> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.profile_pic !== undefined) data.profilePic = dto.profile_pic;
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async upsertGameProfile(userId: string, dto: UpsertGameProfileDto): Promise<GameProfile & { game: { slug: string } }> {
    const game = await this.prisma.game.findUnique({ where: { slug: dto.game_slug } });
    if (!game) {
      throw new BadRequestException(`Game with slug '${dto.game_slug}' not found`);
    }

    // Check if in_game_uid is already used by another user for this game
    const existingUid = await this.prisma.gameProfile.findFirst({
      where: {
        gameId: game.id,
        inGameUid: dto.in_game_uid,
        NOT: { userId },
      },
    });
    if (existingUid) {
      throw new BadRequestException('In-game UID is already linked to another account');
    }

    return this.prisma.gameProfile.upsert({
      where: {
        unique_user_game: {
          userId,
          gameId: game.id,
        },
      },
      update: {
        inGameUid: dto.in_game_uid,
        inGameName: dto.in_game_name,
      },
      create: {
        userId,
        gameId: game.id,
        inGameUid: dto.in_game_uid,
        inGameName: dto.in_game_name,
      },
      include: {
        game: {
          select: { slug: true },
        },
      },
    });
  }

  async getGameProfile(userId: string, gameSlug: string = 'free_fire'): Promise<(GameProfile & { game: { slug: string } }) | null> {
    const game = await this.prisma.game.findUnique({ where: { slug: gameSlug } });
    if (!game) return null;

    return this.prisma.gameProfile.findUnique({
      where: {
        unique_user_game: {
          userId,
          gameId: game.id,
        },
      },
      include: {
        game: { select: { slug: true } },
      },
    });
  }
}
