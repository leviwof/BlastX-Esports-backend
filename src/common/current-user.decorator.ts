import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export interface JwtUser { sub: string; email: string; role?: string }
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtUser => ctx.switchToHttp().getRequest<{ user: JwtUser }>().user);
