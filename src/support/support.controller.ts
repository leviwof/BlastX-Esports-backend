import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../common/public.decorator';
import { JwtUser } from '../common/current-user.decorator';
import { CreateIssueReportDto } from './dto/create-issue-report.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Public()
  @Post('report-issue')
  async reportIssue(
    @Body() dto: CreateIssueReportDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request & { user?: JwtUser },
  ) {
    return this.supportService.reportIssue(dto, headers, req.user?.sub);
  }

  @Public()
  @Post('contact')
  async contactSupport(
    @Body() dto: CreateSupportTicketDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: Request & { user?: JwtUser },
  ) {
    return this.supportService.contactSupport(dto, headers, req.user?.sub);
  }
}
