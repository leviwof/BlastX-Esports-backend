import { IsNotEmpty, IsOptional, IsString, IsBoolean } from 'class-validator';

export class SetRoomCredentialsDto {
  @IsNotEmpty()
  @IsString()
  room_id!: string;

  @IsNotEmpty()
  @IsString()
  room_password!: string;

  @IsOptional()
  @IsBoolean()
  release_now?: boolean = false;
}
