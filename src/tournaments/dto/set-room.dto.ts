import { IsNotEmpty, IsOptional, IsString, IsBoolean } from 'class-validator';

export class SetRoomCredentialsDto {
  @IsNotEmpty()
  @IsString()
  room_id!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  room_password?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @IsOptional()
  @IsBoolean()
  release_now?: boolean = false;
}
