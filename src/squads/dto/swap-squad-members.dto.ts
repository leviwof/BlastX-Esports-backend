import { IsString, MinLength } from 'class-validator';

export class SwapSquadMembersDto {
  @IsString()
  @MinLength(1)
  main_user_id!: string;

  @IsString()
  @MinLength(1)
  sub_user_id!: string;
}
