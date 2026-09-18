import { IsIn, IsString } from 'class-validator'; export class SocialLoginDto { @IsString() token!: string; @IsIn(['google']) provider!: 'google'; }
