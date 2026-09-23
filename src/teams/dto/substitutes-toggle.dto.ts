import { IsBoolean, IsNotEmpty } from 'class-validator';

export class SubstitutesToggleDto {
  @IsNotEmpty()
  @IsBoolean()
  accepting_substitutes!: boolean;
}
