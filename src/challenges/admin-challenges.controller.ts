import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';
import { ListChallengesQuery } from './dto/list-challenges.query';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { AdminChallengeResponse } from './challenge.mapper';
import { PaginatedResult } from '../common/pagination.dto';

@Controller('admin/challenges')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Get()
  async listChallenges(@Query() query: ListChallengesQuery): Promise<PaginatedResult<AdminChallengeResponse>> {
    return this.challengesService.listAdminChallenges(query);
  }

  @Post()
  async createChallenge(@Body() dto: CreateChallengeDto): Promise<AdminChallengeResponse> {
    return this.challengesService.createChallenge(dto);
  }

  @Patch(':id')
  async updateChallenge(
    @Param('id') id: string,
    @Body() dto: UpdateChallengeDto,
  ): Promise<AdminChallengeResponse> {
    return this.challengesService.updateChallenge(id, dto);
  }

  @Delete(':id')
  async deleteChallenge(@Param('id') id: string): Promise<{ message: string; soft_deleted: boolean }> {
    return this.challengesService.deleteChallenge(id);
  }
}
