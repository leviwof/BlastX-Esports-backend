import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, User, GameProfile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertGameProfileDto } from './dto/upsert-game-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';

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
