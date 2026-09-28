import { Module } from '@nestjs/common';
import { ChallengesController } from './challenges.controller';
import { AdminChallengesController } from './admin-challenges.controller';
import { AdminProofsController } from './admin-proofs.controller';
import { ChallengesService } from './challenges.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChallengesController, AdminChallengesController, AdminProofsController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
