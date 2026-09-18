import { TournamentFormat } from '@prisma/client';

const BR_PLACEMENT_POINTS: Record<number, number> = {
  1: 12,
  2: 9,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
};

export function calculatePoints(
  format: TournamentFormat,
  placement: number,
  kills: number,
): { placementPoints: number; killPoints: number; totalPoints: number } {
  if (format === TournamentFormat.CLASH_SQUAD) {
    const placementPoints = placement === 1 ? 1 : 0;
    const killPoints = kills;
    return { placementPoints, killPoints, totalPoints: placementPoints + killPoints };
  }

  // Battle Royale
  const placementPoints = BR_PLACEMENT_POINTS[placement] || 0;
  const killPoints = kills * 1;
  return { placementPoints, killPoints, totalPoints: placementPoints + killPoints };
}
