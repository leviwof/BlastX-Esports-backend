import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NoticeSeverity } from '@prisma/client';

export class CreateNoticeDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsEnum(NoticeSeverity)
  severity?: NoticeSeverity = NoticeSeverity.INFO;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
