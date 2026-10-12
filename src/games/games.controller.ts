import { Controller, Get, UseGuards } from '@nestjs/common';
import { GamesService, GameResponse } from './games.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller()
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get('games')
  async getGames(): Promise<GameResponse[]> {
    return this.gamesService.listGames();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/games')
  async getAdminGames(): Promise<GameResponse[]> {
    return this.gamesService.listGames();
  }
}
