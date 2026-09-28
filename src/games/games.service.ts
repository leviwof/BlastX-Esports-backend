import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface GameResponse {
  id: string;
  slug: string;
  name: string;
}

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  async listGames(): Promise<GameResponse[]> {
    const games = await this.prisma.game.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    return games;
  }
}
