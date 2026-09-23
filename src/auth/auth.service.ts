import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; import { JwtService } from '@nestjs/jwt'; import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { User } from '@prisma/client';
import { MailService } from '../mail/mail.service'; import { RedisService } from '../redis/redis.service'; import { UsersService } from '../users/users.service'; import { toUserResponse, UserResponse } from '../users/user.mapper';
import { LoginDto } from './dto/login.dto'; import { RegisterDto } from './dto/register.dto'; import { GoogleStrategy } from './google.strategy';
@Injectable()
export class AuthService {
  constructor(private readonly users: UsersService, private readonly redis: RedisService, private readonly mail: MailService, private readonly jwt: JwtService, private readonly config: ConfigService, private readonly google: GoogleStrategy) {}
  private otpKey(email: string): string { return `otp:${email}`; } private attemptsKey(email: string): string { return `otp_attempts:${email}`; }
  private hash(otp: string): string { const pepper = this.config.get<string>('OTP_PEPPER') || 'blastx-default-otp-pepper-secret'; return createHash('sha256').update(`${otp}:${pepper}`).digest('hex'); }
  private async issue(user: User): Promise<UserResponse> { const token = await this.jwt.signAsync({ sub: user.id, email: user.email }); return toUserResponse(user, token); }
  async sendOtp(email: string): Promise<{ sent: true }> {
    const rateKey = `otp_rate:${email}`; const count = await this.redis.client.incr(rateKey); if (count === 1) await this.redis.client.expire(rateKey, 600); if (count > 3) throw new HttpException('Too many OTP requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    const otp = randomInt(100000, 1000000).toString(); await this.redis.client.set(this.otpKey(email), this.hash(otp), 'EX', 300); await this.redis.client.del(this.attemptsKey(email)); await this.mail.sendOtp(email, otp); return { sent: true };
  }
  private async verifyOtp(email: string, otp: string): Promise<void> {
    const stored = await this.redis.client.get(this.otpKey(email)); if (!stored) throw new BadRequestException('OTP is invalid or expired');
    const expected = Buffer.from(stored); const candidate = Buffer.from(this.hash(otp)); const valid = expected.length === candidate.length && timingSafeEqual(expected, candidate);
    if (!valid) { const attempts = await this.redis.client.incr(this.attemptsKey(email)); if (attempts === 1) await this.redis.client.expire(this.attemptsKey(email), 300); if (attempts >= 5) { await this.redis.client.del(this.otpKey(email), this.attemptsKey(email)); throw new BadRequestException('Too many incorrect OTP attempts. Request a new OTP.'); } throw new BadRequestException('OTP is invalid or expired'); }
    await this.redis.client.del(this.otpKey(email), this.attemptsKey(email));
  }
  async login(dto: LoginDto): Promise<UserResponse> { await this.verifyOtp(dto.email, dto.otp); const user = await this.users.findByEmail(dto.email); if (!user) throw new BadRequestException('Account not found, please sign up'); if (!user.isActive) throw new UnauthorizedException('Account is inactive'); return this.issue(user); }
  async register(dto: RegisterDto): Promise<UserResponse> { await this.verifyOtp(dto.email, dto.otp); if (await this.users.findByEmail(dto.email)) throw new BadRequestException('An account already exists for this email'); return this.issue(await this.users.create({ name: dto.name, email: dto.email })); }
  async verifyToken(token: string): Promise<{ valid: true }> { try { const payload = await this.jwt.verifyAsync<{ sub: string }>(token); const user = await this.users.findById(payload.sub); if (!user?.isActive) throw new Error(); return { valid: true }; } catch { throw new UnauthorizedException('Invalid or expired token'); } }
  async socialLogin(token: string): Promise<UserResponse> { const identity = await this.google.verify(token); let user = await this.users.findByGoogleId(identity.googleId); if (!user) { user = await this.users.findByEmail(identity.email); user = user ? await this.users.update(user.id, { googleId: identity.googleId }) : await this.users.create({ name: identity.name, email: identity.email, googleId: identity.googleId, profilePic: identity.picture }); } if (!user.isActive) throw new UnauthorizedException('Account is inactive'); return this.issue(user); }
}
