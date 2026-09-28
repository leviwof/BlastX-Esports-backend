import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { UserRole } from '@prisma/client';
import { ListProofsQuery } from './dto/list-proofs.query';
import { RejectProofDto } from './dto/reject-proof.dto';
import { EmptyBodyDto } from './dto/empty-body.dto';
import { AdminProofResponse } from './challenge.mapper';
import { PaginatedResult } from '../common/pagination.dto';

@Controller('admin/proofs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminProofsController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Get()
  async listProofs(@Query() query: ListProofsQuery): Promise<PaginatedResult<AdminProofResponse>> {
    return this.challengesService.listProofs(query);
  }

  @Post(':id/approve')
  async approveProof(
    @Param('id') id: string,
    @Body() _dto: EmptyBodyDto,
    @CurrentUser() user: JwtUser,
  ): Promise<AdminProofResponse> {
    return this.challengesService.approveProof(id, user.sub);
  }

  @Post(':id/reject')
  async rejectProof(
    @Param('id') id: string,
    @Body() dto: RejectProofDto,
    @CurrentUser() user: JwtUser,
  ): Promise<AdminProofResponse> {
    return this.challengesService.rejectProof(id, dto, user.sub);
  }
}
