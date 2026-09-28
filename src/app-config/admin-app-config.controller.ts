import { Controller, Patch, Body, UseGuards } from '@nestjs/common';
import { AppConfigService, AppConfigResponse } from './app-config.service';
import { UpdateConfigDto } from './dto/update-config.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Patch()
  async updateConfig(@Body() dto: UpdateConfigDto): Promise<AppConfigResponse> {
    return this.appConfigService.updateConfig(dto);
  }
}
