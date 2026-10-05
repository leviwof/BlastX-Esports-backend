import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
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
}
