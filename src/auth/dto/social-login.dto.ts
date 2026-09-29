import { IsIn, IsOptional, IsString } from 'class-validator';

export class SocialLoginDto {
  @IsString()
  token!: string;

  @IsIn(['google'])
  provider!: 'google';

  @IsOptional()
  @IsString()
  device_type?: string;

  @IsOptional()
  @IsString()
  device_model?: string;

  @IsOptional()
  @IsString()
  os_version?: string;

  @IsOptional()
  @IsString()
  app_version?: string;
}
