import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { NoticeSeverity } from '@prisma/client';

export class UpdateNoticeDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(NoticeSeverity)
  severity?: NoticeSeverity;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
