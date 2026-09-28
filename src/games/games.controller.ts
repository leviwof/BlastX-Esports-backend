import { Controller, Get } from '@nestjs/common';
import { GamesService, GameResponse } from './games.service';

@Controller()
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get('games')
  async getGames(): Promise<GameResponse[]> {
    return this.gamesService.listGames();
  }

  @Get('admin/games')
  async getAdminGames(): Promise<GameResponse[]> {
    return this.gamesService.listGames();
  }
}
