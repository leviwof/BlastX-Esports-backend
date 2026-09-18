import { IsNotEmpty, IsString } from 'class-validator';

export class DisqualifyRegistrationDto {
  @IsNotEmpty()
  @IsString()
  registration_id!: string;

  @IsNotEmpty()
  @IsString()
  reason!: string;
}
