import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { SupportService } from './support.service';
import { UpdateIssueReportDto } from './dto/update-issue-report.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { QuerySupportContactsDto, QuerySupportIssuesDto } from './dto/query-support.dto';

@Controller('admin/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('issues')
  listIssues(@Query() query: QuerySupportIssuesDto) {
    return this.supportService.listAdminIssues(query);
  }

  @Get('contacts')
  listContacts(@Query() query: QuerySupportContactsDto) {
    return this.supportService.listAdminContacts(query);
  }

  @Patch('issues/:id')
  updateIssue(
    @Param('id') id: string,
    @Body() dto: UpdateIssueReportDto,
  ) {
    return this.supportService.updateIssueReport(id, dto);
  }

  @Patch('contacts/:id')
  updateContact(
    @Param('id') id: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    return this.supportService.updateSupportTicket(id, dto);
  }
}
