import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 50, { message: 'name must be between 2 and 50 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[\d\s\-]{10,25}$/, { message: 'phone must be a valid phone number (10-15 digits)' })
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
