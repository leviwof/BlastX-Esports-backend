import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterFcmTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  fcm_token!: string;

  @IsOptional()
  @IsIn(['android', 'ios'])
  device_type?: 'android' | 'ios';
}
