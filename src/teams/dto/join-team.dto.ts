import { IsBoolean, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TeamMemberRole } from '@prisma/client';

export class PlayerInfoDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  ign?: string;

  @IsOptional()
  @IsString()
  uid?: string;
}

export class JoinTeamDto {
  @IsOptional()
  @IsString()
  invite_code?: string;

  @IsOptional()
  @IsBoolean()
  as_substitute?: boolean;

  @IsOptional()
  @IsString()
  rosterType?: string;

  @IsOptional()
  @IsEnum(TeamMemberRole)
  role?: TeamMemberRole;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlayerInfoDto)
  player?: PlayerInfoDto;
}
