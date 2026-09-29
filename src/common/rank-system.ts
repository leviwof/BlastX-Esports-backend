export interface RankConfig {
  number: number;
  name: string;
  minXP: number;
  nextRankMinXP: number | null;
}

export const RANKS: readonly RankConfig[] = [
  { number: 1, name: 'Rookie', minXP: 0, nextRankMinXP: 500 },
  { number: 2, name: 'Recruit', minXP: 500, nextRankMinXP: 1500 },
  { number: 3, name: 'Fighter', minXP: 1500, nextRankMinXP: 3000 },
  { number: 4, name: 'Warrior', minXP: 3000, nextRankMinXP: 5500 },
  { number: 5, name: 'Veteran', minXP: 5500, nextRankMinXP: 9000 },
  { number: 6, name: 'Elite', minXP: 9000, nextRankMinXP: 14000 },
  { number: 7, name: 'Specialist', minXP: 14000, nextRankMinXP: 20000 },
  { number: 8, name: 'Champion', minXP: 20000, nextRankMinXP: 28000 },
  { number: 9, name: 'Master', minXP: 28000, nextRankMinXP: 38000 },
  { number: 10, name: 'Grandmaster', minXP: 38000, nextRankMinXP: 50000 },
  { number: 11, name: 'Legend', minXP: 50000, nextRankMinXP: 65000 },
  { number: 12, name: 'Mythic', minXP: 65000, nextRankMinXP: 85000 },
  { number: 13, name: 'Immortal', minXP: 85000, nextRankMinXP: 110000 },
  { number: 14, name: 'Apex', minXP: 110000, nextRankMinXP: null },
];

export interface PlayerRankDetails {
  number: number;
  name: string;
  minXP: number;
  maxXP: number | null;
}

export interface NextRankDetails {
  number: number;
  name: string;
  minXP: number;
}

export interface PlayerRankResponse {
  userId: string;
  totalXP: number;
  rank: PlayerRankDetails;
  nextRank: NextRankDetails | null;
  xpRemaining: number;
  progress: number;
  isMaxRank: boolean;
}

export interface ClaimRankDetails {
  number: number;
  name: string;
  minXP: number;
  nextRankMinXP: number | null;
}

export interface PreviousRankDetails {
  number: number;
  name: string;
  minXP: number;
}

export interface ClaimChallengeResponseData {
  challengeId: string;
  claimedXP: number;
  totalXP: number;
  rank: ClaimRankDetails;
  rankChanged: boolean;
  previousRank?: PreviousRankDetails;
}

export function calculateRank(totalXP: number) {
  const safeXP = Math.max(0, Math.floor(Number(totalXP) || 0));

  // Find the highest rank tier where minXP <= safeXP
  let currentRankIndex = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (safeXP >= RANKS[i].minXP) {
      currentRankIndex = i;
      break;
    }
  }

  const currentRank = RANKS[currentRankIndex];
  const nextRank = currentRankIndex < RANKS.length - 1 ? RANKS[currentRankIndex + 1] : null;
  const isMaxRank = nextRank === null;

  const xpRemaining = isMaxRank ? 0 : nextRank.minXP - safeXP;

  let progress = 1.0;
  if (!isMaxRank) {
    const range = nextRank.minXP - currentRank.minXP;
    const earned = safeXP - currentRank.minXP;
    progress = range > 0 ? Math.round((earned / range) * 10000) / 10000 : 0.0;
  }

  return {
    safeXP,
    currentRank,
    nextRank,
    isMaxRank,
    xpRemaining,
    progress,
  };
}
