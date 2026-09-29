import { calculateRank, RANKS } from '../common/rank-system';
import { ChallengesService } from './challenges.service';
import { ChallengeType, ChallengeStatus } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('Player Ranking & XP Progression System', () => {
  describe('calculateRank unit tests', () => {
    it('clamps negative XP to 0 and assigns Rank 1 Rookie', () => {
      const rank = calculateRank(-150);
      expect(rank.safeXP).toBe(0);
      expect(rank.currentRank.number).toBe(1);
      expect(rank.currentRank.name).toBe('Rookie');
      expect(rank.currentRank.minXP).toBe(0);
      expect(rank.currentRank.nextRankMinXP).toBe(500);
      expect(rank.nextRank?.number).toBe(2);
      expect(rank.nextRank?.name).toBe('Recruit');
      expect(rank.nextRank?.minXP).toBe(500);
      expect(rank.xpRemaining).toBe(500);
      expect(rank.progress).toBe(0);
      expect(rank.isMaxRank).toBe(false);
    });

    it('correctly calculates Rank 5 (Veteran) with 7,000 XP (spec example)', () => {
      const rank = calculateRank(7000);
      expect(rank.currentRank.number).toBe(5);
      expect(rank.currentRank.name).toBe('Veteran');
      expect(rank.currentRank.minXP).toBe(5500);
      expect(rank.nextRank?.number).toBe(6);
      expect(rank.nextRank?.name).toBe('Elite');
      expect(rank.nextRank?.minXP).toBe(9000);
      expect(rank.xpRemaining).toBe(2000);
      expect(rank.progress).toBe(0.4286);
      expect(rank.isMaxRank).toBe(false);
    });

    it('correctly calculates Rank 14 (Apex) with 115,000 XP (spec example)', () => {
      const rank = calculateRank(115000);
      expect(rank.currentRank.number).toBe(14);
      expect(rank.currentRank.name).toBe('Apex');
      expect(rank.currentRank.minXP).toBe(110000);
      expect(rank.nextRank).toBeNull();
      expect(rank.xpRemaining).toBe(0);
      expect(rank.progress).toBe(1.0);
      expect(rank.isMaxRank).toBe(true);
    });

    it('verifies all 14 rank threshold boundaries', () => {
      const expectedThresholds = [
        { rank: 1, name: 'Rookie', xp: 0 },
        { rank: 2, name: 'Recruit', xp: 500 },
        { rank: 3, name: 'Fighter', xp: 1500 },
        { rank: 4, name: 'Warrior', xp: 3000 },
        { rank: 5, name: 'Veteran', xp: 5500 },
        { rank: 6, name: 'Elite', xp: 9000 },
        { rank: 7, name: 'Specialist', xp: 14000 },
        { rank: 8, name: 'Champion', xp: 20000 },
        { rank: 9, name: 'Master', xp: 28000 },
        { rank: 10, name: 'Grandmaster', xp: 38000 },
        { rank: 11, name: 'Legend', xp: 50000 },
        { rank: 12, name: 'Mythic', xp: 65000 },
        { rank: 13, name: 'Immortal', xp: 85000 },
        { rank: 14, name: 'Apex', xp: 110000 },
      ];

      for (const t of expectedThresholds) {
        const result = calculateRank(t.xp);
        expect(result.currentRank.number).toBe(t.rank);
        expect(result.currentRank.name).toBe(t.name);
      }
    });
  });

  describe('ChallengesService claimChallenge progression', () => {
    let service: ChallengesService;
    let mockPrisma: any;

    const mockChallenge = {
      id: 'ch_special_booyah',
      title: 'Booyah Champion',
      description: 'Win a match',
      rewardXp: 2000,
      targetProgress: 1.0,
      game: 'Free Fire',
      type: ChallengeType.SPECIAL,
      requiresRecording: false,
      gamePackage: 'com.dts.freefireth',
      iconAsset: null,
      isActive: true,
      createdAt: new Date(),
    };

    beforeEach(() => {
      mockPrisma = {
        challenge: {
          findUnique: jest.fn().mockResolvedValue(mockChallenge),
        },
        userChallenge: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'uc_1',
            userId: 'usr_1',
            challengeId: 'ch_special_booyah',
            currentProgress: 1.0,
            isCompleted: true,
            isClaimed: false,
            status: ChallengeStatus.COMPLETED,
          }),
          upsert: jest.fn().mockResolvedValue({}),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'usr_1',
            xp: 7000,
            rank: 5,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((promises) => Promise.all(promises)),
      };

      service = new ChallengesService(mockPrisma);
    });

    it('triggers promotion response when XP threshold crosses into new rank tier (Rank 5 -> 6)', async () => {
      // User starts at 7,000 XP (Veteran, Rank 5), earns 2,000 XP -> 9,000 XP (Elite, Rank 6)
      const res = await service.claimChallenge('usr_1', 'ch_special_booyah');

      expect(res.success).toBe(true);
      expect(res.data.challengeId).toBe('ch_special_booyah');
      expect(res.data.claimedXP).toBe(2000);
      expect(res.data.totalXP).toBe(9000);
      expect(res.data.rank.number).toBe(6);
      expect(res.data.rank.name).toBe('Elite');
      expect(res.data.rank.minXP).toBe(9000);
      expect(res.data.rank.nextRankMinXP).toBe(14000);
      expect(res.data.rankChanged).toBe(true);
      expect(res.data.previousRank).toEqual({
        number: 5,
        name: 'Veteran',
        minXP: 5500,
      });

      // Verify DB update transaction
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { xp: 9000, rank: 6 },
      });
    });

    it('returns standard response without rankChanged when rank tier stays same', async () => {
      // User starts at 7,000 XP, earns 500 XP -> 7,500 XP (still Veteran, Rank 5)
      mockPrisma.challenge.findUnique.mockResolvedValueOnce({
        ...mockChallenge,
        id: 'ch_daily_01',
        rewardXp: 500,
      });

      const res = await service.claimChallenge('usr_1', 'ch_daily_01');

      expect(res.success).toBe(true);
      expect(res.data.claimedXP).toBe(500);
      expect(res.data.totalXP).toBe(7500);
      expect(res.data.rank.number).toBe(5);
      expect(res.data.rank.name).toBe('Veteran');
      expect(res.data.rank.nextRankMinXP).toBe(9000);
      expect(res.data.rankChanged).toBe(false);
      expect(res.data.previousRank).toBeUndefined();
    });

    it('prevents duplicate claim if already claimed (idempotency rule)', async () => {
      mockPrisma.userChallenge.findUnique.mockResolvedValueOnce({
        id: 'uc_1',
        userId: 'usr_1',
        challengeId: 'ch_special_booyah',
        isClaimed: true,
        status: ChallengeStatus.CLAIMED,
      });

      await expect(service.claimChallenge('usr_1', 'ch_special_booyah')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects claim if challenge requirements are not completed', async () => {
      mockPrisma.userChallenge.findUnique.mockResolvedValueOnce({
        id: 'uc_1',
        userId: 'usr_1',
        challengeId: 'ch_special_booyah',
        currentProgress: 0.5,
        isCompleted: false,
        isClaimed: false,
        status: ChallengeStatus.ACTIVE,
      });

      await expect(service.claimChallenge('usr_1', 'ch_special_booyah')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 404 if challenge does not exist', async () => {
      mockPrisma.challenge.findUnique.mockResolvedValueOnce(null);

      await expect(service.claimChallenge('usr_1', 'unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
