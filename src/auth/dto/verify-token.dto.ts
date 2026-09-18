import { IsJWT } from 'class-validator'; export class VerifyTokenDto { @IsJWT() token!: string; }
