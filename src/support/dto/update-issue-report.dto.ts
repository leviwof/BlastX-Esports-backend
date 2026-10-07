import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { IssueReportStatus } from '@prisma/client';

export class UpdateIssueReportDto {
  @IsOptional()
  @IsEnum(IssueReportStatus)
  status?: IssueReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  admin_notes?: string;
}
