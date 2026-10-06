import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OwnerRole } from '@prisma/client';

export class CreateSquadDto {
  @IsString()
  @MinLength(3, { message: 'Squad name must be at least 3 characters' })
  @MaxLength(30, { message: 'Squad name must be under 30 characters' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(10, { message: 'Tag must be under 10 characters' })
  tag?: string;

  @IsOptional()
  @IsEnum(OwnerRole)
  owner_role?: OwnerRole;

  @IsOptional()
  @IsString()
  game_slug?: string;
}
