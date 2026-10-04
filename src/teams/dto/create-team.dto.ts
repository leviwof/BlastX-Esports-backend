import { IsNotEmpty, IsOptional, IsString, IsUrl, Matches, Length, IsBoolean, IsEnum } from 'class-validator';
import { OwnerRole } from '@prisma/client';

export class CreateTeamDto {
  @IsOptional()
  @IsString()
  game_slug?: string = 'free_fire';

  @IsNotEmpty()
  @IsString()
  @Length(3, 30)
  name!: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,5}$/, { message: 'Tag must be 2 to 5 alphanumeric characters' })
  tag!: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  logo_url?: string;

  @IsOptional()
  @IsBoolean()
  accepting_substitutes?: boolean = true;

  @IsOptional()
  @IsEnum(OwnerRole)
  owner_role?: OwnerRole;

  @IsOptional()
  @IsEnum(OwnerRole)
  ownerRole?: OwnerRole;
}
