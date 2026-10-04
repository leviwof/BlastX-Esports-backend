import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PlayerDetailsDto {
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

export class CreateTournamentTeamDto {
  @IsNotEmpty()
  @IsString()
  @Length(3, 30)
  name!: string;

  @IsOptional()
  @ValidateIf((_object, value) => typeof value !== 'string' || value.trim().length > 0)
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,5}$/, { message: 'Tag must be 2 to 5 alphanumeric characters' })
  tag?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logo_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  accepting_substitutes?: boolean = true;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlayerDetailsDto)
  player?: PlayerDetailsDto;
}
