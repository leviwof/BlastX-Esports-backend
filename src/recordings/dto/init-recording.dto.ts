import { IsNotEmpty, IsNumber, IsString, IsOptional, Min, Max, IsIn } from 'class-validator';

export class InitRecordingDto {
  @IsString()
  @IsNotEmpty()
  client_recording_id: string;

  @IsString()
  @IsNotEmpty()
  started_at: string;

  @IsString()
  @IsNotEmpty()
  stopped_at: string;

  @IsNumber()
  @Min(1)
  duration_seconds: number;

  @IsNumber()
  @Min(1048576) // 1 MB
  @Max(1610612736) // 1.5 GB (1.5 * 1024 * 1024 * 1024)
  size_bytes: number;

  @IsString()
  @IsIn(['video/mp4', 'video/quicktime', 'video/webm'])
  mime_type: string;

  @IsString()
  @IsOptional()
  resolution?: string;

  @IsString()
  @IsOptional()
  device_model?: string;

  @IsString()
  @IsOptional()
  app_version?: string;
}
