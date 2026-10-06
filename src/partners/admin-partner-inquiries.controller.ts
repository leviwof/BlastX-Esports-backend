import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { PartnerInquiryStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { PartnersService } from './partners.service';

@Controller('admin/partners/inquiries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPartnerInquiriesController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get()
  listInquiries() {
    return this.partnersService.listInquiries();
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: PartnerInquiryStatus,
  ) {
    return this.partnersService.updateInquiryStatus(id, status);
  }
}
