import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TransferCaptainDto {
  @IsOptional()
  @IsString()
  new_captain_id?: string;

  @IsOptional()
  @IsString()
  user_id?: string;
}
