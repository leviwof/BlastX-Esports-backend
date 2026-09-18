import { IsOptional, IsString, IsUrl, Matches, Length } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @Length(3, 30)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,5}$/, { message: 'Tag must be 2 to 5 alphanumeric characters' })
  tag?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  logo_url?: string;
}
