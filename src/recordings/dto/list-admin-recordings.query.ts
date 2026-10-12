import { IsOptional, IsString, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RecordingStatus } from '@prisma/client';

export class ListAdminRecordingsQuery {
  @IsOptional()
  @IsString()
  match_key?: string;

  @IsOptional()
  @IsString()
  team_id?: string;

  @IsOptional()
  @IsEnum(RecordingStatus)
  status?: RecordingStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}
