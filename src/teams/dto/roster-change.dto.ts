import { IsArray, ArrayNotEmpty, IsString, IsOptional } from 'class-validator';

export class RosterChangeDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  main_user_ids!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  remove_user_ids?: string[];
}
