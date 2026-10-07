import { Module } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { AdminTournamentsController } from './admin-tournaments.controller';
import { FreeFireLiveController } from './free-fire-live.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchesModule } from '../matches/matches.module';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [PrismaModule, MatchesModule, TeamsModule],
  controllers: [TournamentsController, AdminTournamentsController, FreeFireLiveController],
  providers: [TournamentsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
