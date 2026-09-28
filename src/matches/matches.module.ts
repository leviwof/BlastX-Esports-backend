import { Module } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { AdminMatchesController } from './admin-matches.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [MatchesController, AdminMatchesController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
