import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class BroadcastNotificationDto {
  @Transform(({ value }: { value: string }) => value.trim())
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @Transform(({ value }: { value: string }) => value.trim())
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;
}
