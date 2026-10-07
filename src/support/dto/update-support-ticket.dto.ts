import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SupportTicketStatus } from '@prisma/client';

export class UpdateSupportTicketDto {
  @IsOptional()
  @IsEnum(SupportTicketStatus)
  status?: SupportTicketStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  admin_response?: string;
}
