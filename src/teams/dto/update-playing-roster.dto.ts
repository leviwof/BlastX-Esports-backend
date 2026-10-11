import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class UpdatePlayingRosterDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  main_user_ids!: string[];
}
