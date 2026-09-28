import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectProofDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
