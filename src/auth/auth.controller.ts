import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../common/public.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { VerifyTokenDto } from './dto/verify-token.dto';
import { AdminPasswordLoginDto } from './dto/admin-password-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Public()
  @Post('verify-token')
  verify(@Body() dto: VerifyTokenDto) { return this.service.verifyToken(dto.token); }

  @Public()
  @Post('send-otp')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  sendOtp(@Body() dto: SendOtpDto) { return this.service.sendOtp(dto.email); }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) { return this.service.login(dto); }

  @Public()
  @Post('admin-login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  adminLogin(@Body() dto: AdminPasswordLoginDto) { return this.service.adminPasswordLogin(dto); }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) { return this.service.register(dto); }

  @Public()
  @Post('social-login')
  social(@Body() dto: SocialLoginDto) { return this.service.socialLogin(dto); }

  @Post('logout')
  async logout(@CurrentUser() user: JwtUser, @Req() req: Request) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    return this.service.logout(token, user?.sub);
  }
}
