import { Injectable, Logger } from '@nestjs/common'; import { ConfigService } from '@nestjs/config'; import * as nodemailer from 'nodemailer';
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name); private readonly transporter: nodemailer.Transporter;
  constructor(private readonly config: ConfigService) { this.transporter = nodemailer.createTransport({ host: config.getOrThrow('SMTP_HOST'), port: config.getOrThrow<number>('SMTP_PORT'), auth: config.get<string>('SMTP_USER') ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') } : undefined }); }
  async sendOtp(email: string, otp: string): Promise<void> {
    if (this.config.get('NODE_ENV') !== 'production') this.logger.log(`OTP for ${email}: ${otp}`);
    await this.transporter.sendMail({ from: this.config.getOrThrow('SMTP_FROM'), to: email, subject: 'Your BlastX verification code', text: `Your BlastX Esports verification code is ${otp}. It expires in 5 minutes.` });
  }
}
