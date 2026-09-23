import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { TeamMemberRole } from '@prisma/client';

export class JoinTeamDto {
  @IsOptional()
  @IsString()
  invite_code?: string;

  @IsOptional()
  @IsBoolean()
  as_substitute?: boolean;

  @IsOptional()
  @IsEnum(TeamMemberRole)
  role?: TeamMemberRole;
}
