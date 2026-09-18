import { Module } from '@nestjs/common';
import { LiveGateway } from './live.gateway';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule],
  providers: [LiveGateway],
  exports: [LiveGateway],
})
export class RealtimeModule {}
