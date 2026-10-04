import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 50, { message: 'name must be between 2 and 50 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid 10-digit Indian mobile number' })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'profile_pic must not exceed 1000 characters' })
  profile_pic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  profilePic?: string;
}
