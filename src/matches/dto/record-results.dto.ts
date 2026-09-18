import { IsNotEmpty, IsArray, ValidateNested, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SingleResultDto {
  @IsNotEmpty()
  @IsString()
  registration_id!: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  placement!: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  kills!: number;
}

export class BulkRecordResultsDto {
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SingleResultDto)
  results!: SingleResultDto[];
}
