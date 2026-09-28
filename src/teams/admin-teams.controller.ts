import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';
import { ListAdminTeamsQuery } from './dto/list-admin-teams.query';
import { TeamSummaryResponse, TeamDetailResponse } from './team.mapper';
import { PaginatedResult } from '../common/pagination.dto';

@Controller('admin/teams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  async listTeams(@Query() query: ListAdminTeamsQuery): Promise<PaginatedResult<TeamSummaryResponse>> {
    return this.teamsService.listAdminTeams(query);
  }

  @Get(':id')
  async getTeam(@Param('id') id: string): Promise<TeamDetailResponse> {
    return this.teamsService.getAdminTeamById(id);
  }
}
