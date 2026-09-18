import { Controller, Get, Patch, Put, Body, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpsertGameProfileDto } from './dto/upsert-game-profile.dto';
import { toUserResponse, toGameProfileResponse, UserResponse, GameProfileResponse } from './user.mapper';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: JwtUser): Promise<UserResponse> {
    const dbUser = await this.usersService.findById(user.sub);
    if (!dbUser) {
      throw new NotFoundException('User profile not found');
    }
    return toUserResponse(dbUser);
  }

  @Patch('me')
  async updateProfile(@CurrentUser() user: JwtUser, @Body() dto: UpdateUserDto): Promise<UserResponse> {
    const updated = await this.usersService.updateUserProfile(user.sub, dto);
    return toUserResponse(updated);
  }

  @Put('me/game-profile')
  async upsertGameProfile(@CurrentUser() user: JwtUser, @Body() dto: UpsertGameProfileDto): Promise<GameProfileResponse> {
    const profile = await this.usersService.upsertGameProfile(user.sub, dto);
    return toGameProfileResponse(profile);
  }

  @Get('me/game-profile')
  async getGameProfile(@CurrentUser() user: JwtUser, @Query('game_slug') gameSlug: string = 'free_fire'): Promise<GameProfileResponse> {
    const profile = await this.usersService.getGameProfile(user.sub, gameSlug);
    if (!profile) {
      throw new NotFoundException(`Game profile for '${gameSlug}' not found`);
    }
    return toGameProfileResponse(profile);
  }
}
