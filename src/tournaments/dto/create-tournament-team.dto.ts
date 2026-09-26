import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, Length, Matches, ValidateIf, ValidateNested } from 'class-validator';
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

  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,5}$/, { message: 'Tag must be 2 to 5 alphanumeric characters' })
  tag!: string;

  @IsOptional()
  @IsString()
  @ValidateIf((o) => typeof o.logo_url === 'string' && o.logo_url.trim().length > 0)
  @IsUrl()
  logo_url?: string;

  @IsOptional()
  @IsBoolean()
  accepting_substitutes?: boolean = true;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlayerDetailsDto)
  player?: PlayerDetailsDto;
}
