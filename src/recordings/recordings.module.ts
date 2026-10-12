import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { MatchesModule } from '../matches/matches.module';
import { RecordingsService } from './recordings.service';
import {
  RecordingsController,
  TournamentRecordingsController,
} from './recordings.controller';
import {
  AdminRecordingsController,
  AdminTournamentRecordingsController,
} from './admin-recordings.controller';

@Module({
  imports: [PrismaModule, RedisModule, MatchesModule],
  controllers: [
    RecordingsController,
    TournamentRecordingsController,
    AdminRecordingsController,
    AdminTournamentRecordingsController,
  ],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
