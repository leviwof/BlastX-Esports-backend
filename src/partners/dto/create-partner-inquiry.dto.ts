import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePartnerInquiryDto {
  @IsString()
  @IsOptional()
  @MaxLength(160)
  brand_name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  brandName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  contact_name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(160)
  contactName?: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  partnership_type?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  partnershipType?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  message!: string;
}
