import { IsEnum, IsOptional } from 'class-validator';
import { SquadRole, SquadRosterType } from '@prisma/client';

export class UpdateSquadMemberRoleDto {
  @IsOptional()
  @IsEnum(SquadRosterType)
  roster_type?: SquadRosterType;

  @IsOptional()
  @IsEnum(SquadRole)
  role?: SquadRole;
}
