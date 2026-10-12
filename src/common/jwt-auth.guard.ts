import { CanActivate, ExecutionContext, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtUser } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private lastLoggedErrorTime = 0;

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Unauthorized or invalid token');

    // Check blacklist in Redis (bl_<token>)
    if (this.redis?.client) {
      try {
        const isBlacklisted = await this.redis.client.get(`bl_${token}`);
        if (isBlacklisted) {
          throw new UnauthorizedException('Token has been revoked');
        }
      } catch (err: any) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
        const now = Date.now();
        if (now - this.lastLoggedErrorTime > 60000) {
          this.logger.warn(`Redis blacklist check failed, failing open: ${err.message}`);
          this.lastLoggedErrorTime = now;
        }
      }
    }

    try {
      request.user = await this.jwt.verifyAsync<JwtUser>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Unauthorized or invalid token');
    }
  }
}

