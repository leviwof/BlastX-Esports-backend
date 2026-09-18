import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UpsertGameProfileDto {
  @IsNotEmpty()
  @IsString()
  game_slug: string = 'free_fire';

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{8,12}$/, { message: 'In-game UID must be 8 to 12 digits' })
  in_game_uid!: string;

  @IsNotEmpty()
  @IsString()
  in_game_name!: string;
}
