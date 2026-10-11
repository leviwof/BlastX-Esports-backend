import { IsEnum, IsInt, IsBoolean, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export type TournamentModeDto = 'SQUAD_BR' | 'DUO_BR' | 'SOLO_BR' | 'CLASH_SQUAD';

export class FormatRecommendDto {
  @IsEnum(['SQUAD_BR', 'DUO_BR', 'SOLO_BR', 'CLASH_SQUAD'])
  mode!: TournamentModeDto;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  registrationUnitCount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  maxRounds?: number = 5;

  @IsOptional()
  @IsBoolean()
  exactRounds?: boolean = false;

  @IsOptional()
  constraints?: {
    noByes?: boolean;
    noWildcards?: boolean;
    noUnevenGroups?: boolean;
    equalQualifiersPerGroup?: boolean;
  };
}

export class FormatValidateDto extends FormatRecommendDto {
  // Also accepts a proposed stages array for manual validation
  @IsOptional()
  proposedStages?: Array<{
    round: number;
    units: number;
    groups: number;
    qualifyPerGroup: number;
    isFinal: boolean;
  }>;
}

export class PublishTournamentDto {
  // Revalidates and locks the format
  @IsOptional()
  @IsBoolean()
  confirmLock?: boolean = true;
}
