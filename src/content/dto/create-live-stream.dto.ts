import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CreateLiveStreamDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  subtitle: string;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsOptional()
  @IsString()
  viewer_count?: string;

  @IsOptional()
  @IsBoolean()
  is_live?: boolean;

  @IsOptional()
  @IsBoolean()
  is_official?: boolean;

  @IsUrl()
  image_url: string;

  @IsUrl()
  stream_url: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}
