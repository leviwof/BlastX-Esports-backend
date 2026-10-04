import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InvitationsController } from './invitations.controller';
import { SquadsController } from './squads.controller';
import { SquadsService } from './squads.service';

@Module({
  imports: [PrismaModule],
  controllers: [SquadsController, InvitationsController],
  providers: [SquadsService],
  exports: [SquadsService],
})
export class SquadsModule {}
