import { Injectable, UnauthorizedException } from '@nestjs/common'; import { ConfigService } from '@nestjs/config'; import { OAuth2Client } from 'google-auth-library';
export interface GoogleIdentity { googleId: string; email: string; name: string; picture: string | null }
@Injectable()
export class GoogleStrategy {
  private readonly client = new OAuth2Client(); constructor(private readonly config: ConfigService) {}
  async verify(token: string): Promise<GoogleIdentity> {
    try { const ticket = await this.client.verifyIdToken({ idToken: token, audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_IDS').split(',').map((id) => id.trim()) }); const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || !payload.email_verified) throw new Error('Invalid Google identity');
      return { googleId: payload.sub, email: payload.email.toLowerCase(), name: payload.name?.trim() || payload.email.split('@')[0], picture: payload.picture ?? null };
    } catch { throw new UnauthorizedException('Invalid Google token'); }
  }
}
