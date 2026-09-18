import { IsNotEmpty, IsString } from 'class-validator';

export class JoinTeamDto {
  @IsNotEmpty()
  @IsString()
  invite_code!: string;
}
