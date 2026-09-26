import { IsOptional, IsString } from 'class-validator';

export class SubmitProofDto {
  @IsOptional()
  @IsString()
  challenge_id?: string;

  @IsOptional()
  @IsString()
  resolution?: string;
}

export interface UploadedProofFile {
  fieldname?: string;
  originalname: string;
  encoding?: string;
  mimetype: string;
  size?: number;
  buffer: Buffer;
}
