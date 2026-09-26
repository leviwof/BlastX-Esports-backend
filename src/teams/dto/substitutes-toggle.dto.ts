import { IsBoolean, IsOptional } from 'class-validator';

export class SubstitutesToggleDto {
  @IsOptional()
  @IsBoolean()
  accepting_substitutes?: boolean;

  @IsOptional()
  @IsBoolean()
  acceptingSubstitutes?: boolean;
}
