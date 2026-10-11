import { Module } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { TournamentBracketService } from './tournament-bracket.service';
import { FormatEngineService } from './format-engine.service';
import { GenericBracketService } from './generic-bracket.service';
import { RegistrationService } from './registration.service';
import { TournamentsController } from './tournaments.controller';
import { AdminTournamentsController } from './admin-tournaments.controller';
import { FreeFireLiveController } from './free-fire-live.controller';
import { RegistrationApprovalsController } from './registration-approvals.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchesModule } from '../matches/matches.module';
import { TeamsModule } from '../teams/teams.module';
import { SquadsModule } from '../squads/squads.module';

@Module({
  imports: [PrismaModule, MatchesModule, TeamsModule, SquadsModule],
  controllers: [
    TournamentsController,
    AdminTournamentsController,
    FreeFireLiveController,
    RegistrationApprovalsController,
  ],
  providers: [
    TournamentsService,
    TournamentBracketService,
    FormatEngineService,
    GenericBracketService,
    RegistrationService,
  ],
  exports: [
    TournamentsService,
    TournamentBracketService,
    FormatEngineService,
    GenericBracketService,
    RegistrationService,
  ],
})
export class TournamentsModule {}
