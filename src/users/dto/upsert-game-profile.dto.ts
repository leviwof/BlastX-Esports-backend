import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class UpsertGameProfileDto {
  @IsNotEmpty({ message: 'game_slug is required' })
  @IsString({ message: 'game_slug must be a string' })
  game_slug: string = 'free_fire';

  @IsNotEmpty({ message: 'in_game_uid is required' })
  @IsString({ message: 'in_game_uid must be a string' })
  @Length(1, 35, { message: 'in_game_uid must be between 1 and 35 characters long' })
  in_game_uid!: string;

  @IsNotEmpty({ message: 'in_game_name is required' })
  @IsString({ message: 'in_game_name must be a string' })
  @MaxLength(30, { message: 'in_game_name must not exceed 30 characters' })
  in_game_name!: string;
}
