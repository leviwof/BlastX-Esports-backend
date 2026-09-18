import { IsNotEmpty, IsOptional, IsString, IsUrl, Matches, Length } from 'class-validator';

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
}
