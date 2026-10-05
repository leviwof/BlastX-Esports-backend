import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreatePartnerInquiryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  brand_name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  contact_name: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  partnership_type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message: string;
}
