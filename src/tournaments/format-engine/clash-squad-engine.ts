export interface ClashRound {
  roundNumber: number;
  matchCount: number;
  teamsRemaining: number;
}

export interface ClashBracket {
  totalTeams: number;
  totalRounds: number;
  rounds: ClashRound[];
}

/**
 * A valid Clash Squad capacity must be a power of two and >= 2.
 */
export function isValidClashCapacity(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

/**
 * Find nearest valid Clash Squad capacities around an invalid n.
 * Returns [lower, higher] where lower < n < higher and both are powers of 2.
 */
export function nearestClashCapacities(n: number): { lower: number | null; higher: number | null } {
  if (n < 2) return { lower: null, higher: 2 };
  let lower: number | null = null;
  let higher: number | null = null;
  let p = 1;
  while (p < n) p <<= 1;
  // p is first power of 2 >= n
  if (p === n) return { lower: n >> 1 || null, higher: p << 1 };
  higher = p;
  lower = p >> 1;
  if (lower < 2) lower = null;
  return { lower, higher };
}

/**
 * Build the complete Clash Squad bracket for n teams (must be power of 2).
 */
export function buildClashBracket(n: number): ClashBracket {
  if (!isValidClashCapacity(n)) {
    throw new Error(`Invalid Clash Squad capacity: ${n}. Must be a power of 2 >= 2.`);
  }
  const rounds: ClashRound[] = [];
  let remaining = n;
  let roundNumber = 1;
  while (remaining > 1) {
    const matchCount = remaining / 2;
    rounds.push({ roundNumber, matchCount, teamsRemaining: remaining });
    remaining = matchCount;
    roundNumber++;
  }
  return { totalTeams: n, totalRounds: rounds.length, rounds };
}
