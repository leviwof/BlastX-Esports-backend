import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { AdminTeamsController } from './admin-teams.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SquadsModule } from '../squads/squads.module';

@Module({
  imports: [PrismaModule, SquadsModule],
  controllers: [TeamsController, AdminTeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
