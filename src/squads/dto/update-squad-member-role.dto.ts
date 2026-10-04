import { IsEnum } from 'class-validator';
import { SquadRosterType } from '@prisma/client';

export class UpdateSquadMemberRoleDto {
  @IsEnum(SquadRosterType)
  roster_type!: SquadRosterType;
}
