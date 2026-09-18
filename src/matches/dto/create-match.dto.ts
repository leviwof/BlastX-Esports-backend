import { IsNotEmpty, IsInt, Min, IsString, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMatchDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  match_number!: number;

  @IsNotEmpty()
  @IsString()
  map!: string;

  @IsNotEmpty()
  @IsDateString()
  scheduled_at!: string;
}
