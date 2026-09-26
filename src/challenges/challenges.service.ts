import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeType, ChallengeStatus } from '@prisma/client';
import {
  toChallengeResponse,
  ChallengeResponse,
  SubmitProofResponse,
} from './challenge.mapper';
import { UploadedProofFile } from './dto/submit-proof.dto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ChallengesService implements OnModuleInit {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultChallenges();
  }

  async seedDefaultChallenges() {
    try {
      const count = await this.prisma.challenge.count();
      if (count > 0) return;

      const defaultChallenges = [
        {
          id: 'c1',
          title: 'First Blood',
          description: 'Get 5 kills in Battle Royale mode.',
          rewardXp: 100,
          targetProgress: 5.0,
          game: 'Free Fire',
          type: ChallengeType.DAILY,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/kill.png',
          isActive: true,
        },
        {
          id: 'c2',
          title: 'Booyah Hunter',
          description: 'Win 1 match in Battle Royale / Clash Squad.',
          rewardXp: 500,
          targetProgress: 1.0,
          game: 'Free Fire',
          type: ChallengeType.WEEKLY,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/trophy.png',
          isActive: true,
        },
        {
          id: 'c3',
          title: 'Clutch King',
          description: 'Eliminate 3 squads in ranked matches.',
          rewardXp: 300,
          targetProgress: 3.0,
          game: 'Free Fire',
          type: ChallengeType.DAILY,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/kill.png',
          isActive: true,
        },
        {
          id: 'c4',
          title: 'Survival Master',
          description: 'Survive until top 3 without being eliminated.',
          rewardXp: 200,
          targetProgress: 1.0,
          game: 'Free Fire',
          type: ChallengeType.SPECIAL,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/trophy.png',
          isActive: true,
        },
      ];

      for (const ch of defaultChallenges) {
        await this.prisma.challenge.upsert({
          where: { id: ch.id },
          update: ch,
          create: ch,
        });
      }
      this.logger.log('Default esports challenges seeded successfully');
    } catch (err: any) {
      this.logger.warn(`Could not seed default challenges: ${err.message}`);
    }
  }

  async getChallenges(userId: string): Promise<ChallengeResponse[]> {
    const challenges = await this.prisma.challenge.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const userProgressList = await this.prisma.userChallenge.findMany({
      where: { userId },
    });

    const progressMap = new Map(userProgressList.map((up) => [up.challengeId, up]));

    return challenges.map((ch) => toChallengeResponse(ch, progressMap.get(ch.id)));
  }

  async claimChallenge(userId: string, challengeId: string): Promise<ChallengeResponse> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException(`Challenge with ID '${challengeId}' not found`);
    }

    const userChallenge = await this.prisma.userChallenge.findUnique({
      where: { unique_user_challenge: { userId, challengeId } },
    });

    // Check if already claimed
    if (userChallenge?.isClaimed || userChallenge?.status === ChallengeStatus.CLAIMED) {
      throw new BadRequestException('Reward has already been claimed for this challenge');
    }

    // Check if eligible / completed
    const isCompleted =
      userChallenge?.isCompleted ||
      (userChallenge && userChallenge.currentProgress >= challenge.targetProgress);

    if (!isCompleted) {
      throw new BadRequestException('Challenge criteria not met yet. Complete the challenge before claiming.');
    }

    // Transactionally mark claimed and award XP to user
    const [updatedProgress] = await this.prisma.$transaction([
      this.prisma.userChallenge.upsert({
        where: { unique_user_challenge: { userId, challengeId } },
        update: {
          isClaimed: true,
          status: ChallengeStatus.CLAIMED,
          claimedAt: new Date(),
        },
        create: {
          userId,
          challengeId,
          currentProgress: challenge.targetProgress,
          isCompleted: true,
          isClaimed: true,
          status: ChallengeStatus.CLAIMED,
          claimedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          xp: { increment: challenge.rewardXp },
        },
      }),
    ]);

    return toChallengeResponse(challenge, updatedProgress);
  }

  async submitProof(
    userId: string,
    challengeId: string,
    file?: UploadedProofFile,
    resolution: string = '480p',
  ): Promise<SubmitProofResponse> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException(`Challenge with ID '${challengeId}' not found`);
    }

    if (!file) {
      throw new BadRequestException('Missing proof video file. An .mp4 match screen recording is required.');
    }

    // Validate mime / extension
    const allowedMime = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'application/octet-stream'];
    const isMp4Ext = file.originalname.toLowerCase().endsWith('.mp4');
    if (!allowedMime.includes(file.mimetype) && !isMp4Ext) {
      throw new BadRequestException('Invalid file type. Only video files (.mp4) are accepted as match proof.');
    }

    // Ensure uploads directory exists
    const uploadDir = path.join(process.cwd(), 'uploads', 'proofs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uniqueFilename = `${challengeId}_${userId}_${Date.now()}.mp4`;
    const filePath = path.join(uploadDir, uniqueFilename);
    fs.writeFileSync(filePath, file.buffer);

    const baseUrl = process.env.BASE_URL || 'https://blastx-esports-backend-production-4b5f.up.railway.app';
    const proofUrl = `${baseUrl}/uploads/proofs/${uniqueFilename}`;

    // Update user challenge status to PROOF_SUBMITTED and mark completed for verification
    await this.prisma.userChallenge.upsert({
      where: { unique_user_challenge: { userId, challengeId } },
      update: {
        proofUrl,
        status: ChallengeStatus.PROOF_SUBMITTED,
        currentProgress: challenge.targetProgress,
        isCompleted: true,
        submittedAt: new Date(),
      },
      create: {
        userId,
        challengeId,
        proofUrl,
        status: ChallengeStatus.PROOF_SUBMITTED,
        currentProgress: challenge.targetProgress,
        isCompleted: true,
        isClaimed: false,
        submittedAt: new Date(),
      },
    });

    return {
      status: 'success',
      message: 'Proof uploaded successfully',
      challenge_id: challengeId,
      proof_url: proofUrl,
    };
  }
}
