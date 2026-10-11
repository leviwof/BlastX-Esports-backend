import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';

@Controller(['registration-approvals', 'api/registration-approvals'])
@UseGuards(JwtAuthGuard)
export class RegistrationApprovalsController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Get('me')
  async getMyApprovals(
    @CurrentUser() user: JwtUser,
    @Query('status') status?: 'PENDING' | 'ALL',
  ) {
    return this.registrationService.getUserApprovals(user.sub, status);
  }

  @Get(':id')
  async getApprovalById(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.registrationService.getApprovalById(user.sub, id);
  }

  @Post(':id/approve')
  async approveApproval(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.registrationService.approve(user.sub, id);
  }

  @Post(':id/decline')
  async declineApproval(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ) {
    return this.registrationService.decline(user.sub, id);
  }
}
