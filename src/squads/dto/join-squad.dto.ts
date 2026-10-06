import { IsNotEmpty, IsString } from 'class-validator';

export class JoinSquadDto {
  @IsString()
  @IsNotEmpty({ message: 'squad_code is required' })
  squad_code: string;
}
