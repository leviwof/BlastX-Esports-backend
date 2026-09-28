import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminStatsService, DashboardStatsResponse } from './admin-stats.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminStatsController {
  constructor(private readonly adminStatsService: AdminStatsService) {}

  @Get()
  async getStats(): Promise<DashboardStatsResponse> {
    return this.adminStatsService.getDashboardStats();
  }
}
