import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SaveDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(4096)
  token!: string;

  @IsOptional()
  @IsString()
  @IsIn(['android', 'ios'])
  platform?: 'android' | 'ios';
}

export class DeleteDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(4096)
  token!: string;
}

export class NotificationQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
