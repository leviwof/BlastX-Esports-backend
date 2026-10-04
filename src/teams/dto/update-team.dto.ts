import { IsOptional, IsString, IsUrl, Matches, Length } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @Length(3, 30)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 15)
  tag?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  logo_url?: string;
}
