import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null = null;
  private readonly resendApiKey: string | null = null;
  private readonly brevoApiKey: string | null = null;

  constructor(private readonly config: ConfigService) {
    const smtpPass = this.config.get<string>('SMTP_PASS') || '';
    const resendKey = this.config.get<string>('RESEND_API_KEY');
    const brevoKey = this.config.get<string>('BREVO_API_KEY');

    // Automatic HTTPS API detection for Brevo and Resend to bypass Railway SMTP port blocks
    if (brevoKey || smtpPass.startsWith('xkeysib-')) {
      this.brevoApiKey = brevoKey || smtpPass;
      this.logger.log('MailService initialized with Brevo HTTPS API (port 443)');
    } else if (resendKey || smtpPass.startsWith('re_')) {
      this.resendApiKey = resendKey || smtpPass;
      this.logger.log('MailService initialized with Resend HTTPS API (port 443)');
    } else {
      const host = this.config.get<string>('SMTP_HOST') || 'localhost';
      const port = Number(this.config.get('SMTP_PORT')) || 587;
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASS');

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
        family: 4,
      } as nodemailer.TransportOptions);
      this.logger.log(`MailService initialized with SMTP (${host}:${port})`);
    }
  }

  async sendOtp(email: string, otp: string): Promise<void> {
    if (this.config.get('NODE_ENV') !== 'production') {
      this.logger.log(`OTP for ${email}: ${otp}`);
    }

    const from =
      this.config.get<string>('SMTP_FROM') ||
      this.config.get<string>('SMTP_USER') ||
      'noreply@blastixesports.com';
    const subject = 'Your BlastiX verification code';
    const text = `Your BlastiX Esports verification code is ${otp}. It expires in 5 minutes.`;

    // 1. Brevo HTTPS API (No custom domain required, works with any recipient)
    if (this.brevoApiKey) {
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': this.brevoApiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            sender: {
              name: 'BlastiX Esports',
              email: from,
            },
            to: [{ email }],
            subject,
            textContent: text,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          this.logger.error(`Brevo API failed (${response.status}): ${errBody}`);
          let msg = 'Failed to deliver OTP email via Brevo';
          try {
            const parsed = JSON.parse(errBody);
            if (parsed.message) msg = parsed.message;
          } catch {
            // Keep default msg
          }
          throw new HttpException(msg, HttpStatus.BAD_GATEWAY);
        }

        this.logger.log(`OTP email sent successfully to ${email} via Brevo HTTPS API`);
        return;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        this.logger.error(`Brevo API network error: ${err instanceof Error ? err.message : String(err)}`);
        throw new HttpException('Failed to connect to Brevo email service', HttpStatus.BAD_GATEWAY);
      }
    }

    // 2. Resend HTTPS API
    if (this.resendApiKey) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [email],
            subject,
            text,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          this.logger.error(`Resend API failed (${response.status}): ${errBody}`);
          let msg = 'Failed to deliver OTP email';
          try {
            const parsed = JSON.parse(errBody);
            if (parsed.message) msg = parsed.message;
          } catch {
            // Keep default msg
          }
          throw new HttpException(msg, HttpStatus.BAD_GATEWAY);
        }

        this.logger.log(`OTP email sent successfully to ${email} via Resend HTTPS API`);
        return;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        this.logger.error(`Resend API network error: ${err instanceof Error ? err.message : String(err)}`);
        throw new HttpException('Failed to connect to email service', HttpStatus.BAD_GATEWAY);
      }
    }

    // 3. Fallback: Nodemailer SMTP
    if (!this.transporter) {
      throw new HttpException('No mail transport configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      await this.transporter.sendMail({
        from,
        to: email,
        subject,
        text,
      });
      this.logger.log(`OTP email sent successfully to ${email} via SMTP`);
    } catch (err) {
      this.logger.error(`SMTP sendMail failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new HttpException(
        `Failed to deliver OTP email: ${err instanceof Error ? err.message : 'SMTP delivery error'}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
