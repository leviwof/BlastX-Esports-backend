import { Module } from '@nestjs/common';
import { LiveGateway } from './live.gateway';

@Module({
  imports: [],
  providers: [LiveGateway],
  exports: [LiveGateway],
})
export class RealtimeModule {}
