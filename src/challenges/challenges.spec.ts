import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { ChallengeType, ChallengeStatus } from '@prisma/client';
import * as fs from 'fs';

describe('ChallengesService', () => {
  let service: ChallengesService;
  let mockPrisma: any;

  const mockChallenge = {
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
    createdAt: new Date(),
  };

  const mockUserChallenge = {
    id: 'uc_1',
    userId: 'user_123',
    challengeId: 'c1',
    currentProgress: 5.0,
    status: ChallengeStatus.COMPLETED,
    isCompleted: true,
    isClaimed: false,
    proofUrl: null,
    submittedAt: null,
    claimedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      challenge: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([mockChallenge]),
        findUnique: jest.fn().mockResolvedValue(mockChallenge),
        upsert: jest.fn(),
      },
      userChallenge: {
        findMany: jest.fn().mockResolvedValue([mockUserChallenge]),
        findUnique: jest.fn().mockResolvedValue(mockUserChallenge),
        upsert: jest.fn().mockResolvedValue({
          ...mockUserChallenge,
          isClaimed: true,
          status: ChallengeStatus.CLAIMED,
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user_123', xp: 0, rank: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'user_123', xp: 100 }),
      },
      $transaction: jest.fn().mockImplementation((promises) => Promise.all(promises)),
    };

    service = new ChallengesService(mockPrisma);
  });

  describe('getChallenges', () => {
    it('returns challenges list with user progress matching Flutter contract', async () => {
      const result = await service.getChallenges('user_123');

      expect(result).toHaveLength(1);
      const ch = result[0];
      expect(ch.id).toBe('c1');
      expect(ch.title).toBe('First Blood');
      expect(ch.reward_xp).toBe(100);
      expect(ch.current_progress).toBe(5.0);
      expect(ch.target_progress).toBe(5.0);
      expect(ch.game).toBe('Free Fire');
      expect(ch.type).toBe('DAILY');
      expect(ch.is_completed).toBe(true);
      expect(ch.is_claimed).toBe(false);
      expect(ch.requires_recording).toBe(true);
      expect(ch.game_package).toBe('com.dts.freefireth');
      expect(ch.icon_asset).toBe('assets/icons/kill.png');
      expect(ch.status).toBe('COMPLETED');
    });

    it('defaults user progress when user has not attempted challenge yet', async () => {
      mockPrisma.userChallenge.findMany.mockResolvedValueOnce([]);

      const result = await service.getChallenges('user_123');
      expect(result).toHaveLength(1);
      const ch = result[0];
      expect(ch.current_progress).toBe(0.0);
      expect(ch.is_completed).toBe(false);
      expect(ch.is_claimed).toBe(false);
      expect(ch.status).toBe('ACTIVE');
    });
  });

  describe('claimChallenge', () => {
    it('successfully claims completed challenge and credits XP to user account', async () => {
      const result = await service.claimChallenge('user_123', 'c1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data.challengeId).toBe('c1');
      expect(result.data.claimedXP).toBe(100);
      expect(result.data.totalXP).toBe(100);
      expect(result.data.rank.number).toBe(1);
      expect(result.data.rank.name).toBe('Rookie');
      expect(result.data.rankChanged).toBe(false);
    });

    it('throws 400 BadRequestException if challenge was already claimed', async () => {
      mockPrisma.userChallenge.findUnique.mockResolvedValueOnce({
        ...mockUserChallenge,
        isClaimed: true,
        status: ChallengeStatus.CLAIMED,
      });

      await expect(service.claimChallenge('user_123', 'c1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 BadRequestException if challenge criteria not met yet', async () => {
      mockPrisma.userChallenge.findUnique.mockResolvedValueOnce({
        ...mockUserChallenge,
        currentProgress: 2.0,
        isCompleted: false,
        status: ChallengeStatus.ACTIVE,
      });

      await expect(service.claimChallenge('user_123', 'c1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 NotFoundException if challenge does not exist', async () => {
      mockPrisma.challenge.findUnique.mockResolvedValueOnce(null);

      await expect(service.claimChallenge('user_123', 'unknown_c')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('submitProof', () => {
    it('throws 400 if no video file is uploaded', async () => {
      await expect(service.submitProof('user_123', 'c1', undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 if video file is smaller than 10KB (corrupted or empty)', async () => {
      const smallFile: any = {
        originalname: 'corrupt.mp4',
        mimetype: 'video/mp4',
        buffer: Buffer.alloc(1024), // 1 KB
      };

      await expect(service.submitProof('user_123', 'c1', smallFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 400 if file is not a video format', async () => {
      const fakeFile: any = {
        originalname: 'proof.txt',
        mimetype: 'text/plain',
        buffer: Buffer.alloc(20 * 1024),
      };

      await expect(service.submitProof('user_123', 'c1', fakeFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('saves proof file, updates user challenge status to PROOF_SUBMITTED, and returns success contract', async () => {
      const fakeFile: any = {
        originalname: 'recording_480p.mp4',
        mimetype: 'video/mp4',
        buffer: Buffer.alloc(200 * 1024), // 200 KB valid test video
      };

      const result = await service.submitProof('user_123', 'c1', fakeFile, '480p');

      expect(result).toBeDefined();
      expect(result.status).toBe('success');
      expect(result.message).toBe('Proof uploaded successfully');
      expect(result.challenge_id).toBe('c1');
      expect(result.proof_url).toBeDefined();
      expect(mockPrisma.userChallenge.upsert).toHaveBeenCalled();
    });

    it('does not accept production proofs without durable storage configured', async () => {
      const previousEnv = {
        nodeEnv: process.env.NODE_ENV,
        driveRefreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
        supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      };
      process.env.NODE_ENV = 'production';
      delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      try {
        const fakeFile: any = {
          originalname: 'recording_480p.mp4',
          mimetype: 'video/mp4',
          buffer: Buffer.alloc(200 * 1024),
        };

        await expect(service.submitProof('user_123', 'c1', fakeFile)).rejects.toThrow(
          'Proof video storage is not configured',
        );
        expect(mockPrisma.userChallenge.upsert).not.toHaveBeenCalled();
      } finally {
        if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnv.nodeEnv;
        if (previousEnv.driveRefreshToken === undefined) delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
        else process.env.GOOGLE_DRIVE_REFRESH_TOKEN = previousEnv.driveRefreshToken;
        if (previousEnv.supabaseUrl === undefined) delete process.env.SUPABASE_URL;
        else process.env.SUPABASE_URL = previousEnv.supabaseUrl;
        if (previousEnv.supabaseSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
        else process.env.SUPABASE_SECRET_KEY = previousEnv.supabaseSecretKey;
        if (previousEnv.supabaseServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = previousEnv.supabaseServiceRoleKey;
      }
    });
  });
});
