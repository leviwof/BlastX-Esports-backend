import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateConfigDto {
  @IsOptional()
  @IsBoolean()
  is_maintenance?: boolean;

  @IsOptional()
  @IsString()
  maintenance_message?: string;

  @IsOptional()
  @IsString()
  min_version?: string;

  @IsOptional()
  @IsString()
  latest_version?: string;

  @IsOptional()
  @IsString()
  update_url?: string;
}
