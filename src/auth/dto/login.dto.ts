import { Matches } from 'class-validator'; import { SendOtpDto } from './send-otp.dto';
export class LoginDto extends SendOtpDto { @Matches(/^\d{6}$/) otp!: string; }
