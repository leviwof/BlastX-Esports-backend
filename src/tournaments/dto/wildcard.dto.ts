import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class OpenWildCardDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  entryFee?: number = 0;
}

export class AssignWildCardSlotDto {
  @IsNotEmpty()
  @IsString()
  teamId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  slotNumber!: number;
}
