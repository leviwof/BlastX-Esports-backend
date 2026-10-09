import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ResolveTieBreakerDto {
  @IsNotEmpty()
  @IsString()
  selectedTeamId!: string;
}

export class AssembleGrandFinalDto {
  @IsOptional()
  @IsString()
  specialInviteTeamId?: string;
}

export class FillGrandFinalSlotDto {
  @IsNotEmpty()
  @IsString()
  teamId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SetGroupRoomCredentialsDto {
  @IsNotEmpty()
  @IsString()
  roomId!: string;

  @IsNotEmpty()
  @IsString()
  roomPassword!: string;

  @IsOptional()
  @IsDateString()
  credentialsReleasedAt?: string;

  @IsOptional()
  @IsBoolean()
  releaseNow?: boolean;
}
