import { Controller, Get, Patch, Put, Post, Body, Query, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Public } from '../common/public.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpsertGameProfileDto } from './dto/upsert-game-profile.dto';
import { toGameProfileResponse, UserResponse, GameProfileResponse } from './user.mapper';
import { GlobalLeaderboardQuery } from './dto/global-leaderboard.query';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Get('leaderboard')
  async getGlobalLeaderboard(@Query() query: GlobalLeaderboardQuery) {
    return this.usersService.getGlobalLeaderboard(query);
  }

  @Get('me')
  async getProfile(@CurrentUser() user: JwtUser): Promise<UserResponse> {
    const profile = await this.usersService.getProfileWithStats(user.sub);
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }
    return profile;
  }

  @Get('me/rank')
  async getMyRank(@CurrentUser() user: JwtUser) {
    const data = await this.usersService.getUserRank(user.sub);
    return {
      success: true,
      data,
    };
  }

  @Get(':userId/rank')
  async getUserRankById(@Param('userId') userId: string, @CurrentUser() user: JwtUser) {
    const targetUserId = userId === 'me' ? user.sub : userId;
    const data = await this.usersService.getUserRank(targetUserId);
    return {
      success: true,
      data,
    };
  }

  @Patch('me')
  @Put('me')
  async updateProfile(@CurrentUser() user: JwtUser, @Body() dto: UpdateUserDto): Promise<UserResponse> {
    await this.usersService.updateUserProfile(user.sub, dto);
    const profile = await this.usersService.getProfileWithStats(user.sub);
    if (!profile) {
      throw new NotFoundException('User profile not found');
    }
    return profile;
  }

  @Post('me/game-profile')
  async createGameProfile(@CurrentUser() user: JwtUser, @Body() dto: UpsertGameProfileDto): Promise<GameProfileResponse> {
    const profile = await this.usersService.upsertGameProfile(user.sub, dto);
    return toGameProfileResponse(profile);
  }

  @Put('me/game-profile')
  async upsertGameProfile(@CurrentUser() user: JwtUser, @Body() dto: UpsertGameProfileDto): Promise<GameProfileResponse> {
    const profile = await this.usersService.upsertGameProfile(user.sub, dto);
    return toGameProfileResponse(profile);
  }

  @Get('me/game-profile')
  async getGameProfile(
    @CurrentUser() user: JwtUser,
    @Query('game_slug') gameSlug: string = 'free_fire',
  ): Promise<GameProfileResponse | null> {
    const profile = await this.usersService.getGameProfile(user.sub, gameSlug);
    if (!profile) {
      return null;
    }
    return toGameProfileResponse(profile);
  }
}
