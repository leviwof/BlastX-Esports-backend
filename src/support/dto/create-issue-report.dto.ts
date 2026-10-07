import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateIssueReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  issue_type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  tournament_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  device_model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  app_version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  os_version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  device_type?: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  user_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  user_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  user_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  free_fire_uid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  in_game_name?: string;

  @IsOptional()
  @IsString()
  submitted_at?: string;
}
