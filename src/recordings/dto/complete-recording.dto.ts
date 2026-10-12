import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CompleteRecordingDto {
  @IsNumber()
  @Min(1)
  @IsNotEmpty()
  size_bytes: number;

  @IsString()
  @IsOptional()
  storage_file_id?: string;
}
