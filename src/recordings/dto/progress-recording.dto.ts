import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class ProgressRecordingDto {
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  uploaded_bytes: number;
}
