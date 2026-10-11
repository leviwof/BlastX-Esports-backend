/**
 * Greatest Common Divisor — Euclidean algorithm.
 */
export function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * For a stage with G groups and lobby size L,
 * returns all valid equal qualifier counts Q (1 ≤ Q < L) such that:
 *   G * Q ≡ 0 (mod L)   AND   G * Q < G * L (some elimination)
 *
 * Formula: step = L / gcd(L, G)
 * Legal Q values: step, 2*step, 3*step, ..., up to L-1
 * (Q = L means all advance = no elimination, so exclude it)
 */
export function legalQualifierCounts(groupCount: number, lobbySize: number): number[] {
  const step = lobbySize / gcd(lobbySize, groupCount);
  const result: number[] = [];
  for (let q = step; q < lobbySize; q += step) {
    result.push(q);
  }
  return result;
}

export interface BRStage {
  roundNumber: number;
  lobbyUnits: number;
  groupCount: number;
  qualifiersPerGroup: number;
  nextLobbyUnits: number;
  isFinal: boolean;
}

export interface BRPath {
  stages: BRStage[];
  totalRounds: number; // includes the final lobby
}

/**
 * Memoized recursive BR path search.
 *
 * Rules:
 *  - N must be divisible by L and >= L
 *  - Final: N === finalUnits (one full final lobby)
 *  - Each step: nextN = G * Q where Q is in legalQualifierCounts(G, L)
 *  - nextN must be < N (elimination), >= finalUnits, divisible by L
 *  - If nextN === finalUnits: path ends with a final stage
 *  - Recursion depth limited by roundsLeft
 */
export function searchBRPaths(
  N: number,
  L: number,
  finalUnits: number,
  roundsLeft: number,
  roundNumber: number,
  memo: Map<string, BRPath[]> = new Map(),
): BRPath[] {
  const key = `${N}:${roundsLeft}:${roundNumber}`;
  if (memo.has(key)) return memo.get(key)!;

  // Base: N is exactly the final
  if (N === finalUnits) {
    if (roundsLeft >= 0) {
      const result: BRPath[] = [{
        stages: [{
          roundNumber,
          lobbyUnits: N,
          groupCount: 1,
          qualifiersPerGroup: 0,
          nextLobbyUnits: 0,
          isFinal: true,
        }],
        totalRounds: 1,
      }];
      memo.set(key, result);
      return result;
    }
    memo.set(key, []);
    return [];
  }

  // Must have rounds left to eliminate
  if (roundsLeft <= 0) {
    memo.set(key, []);
    return [];
  }

  // N must be divisible by L
  if (N % L !== 0) {
    memo.set(key, []);
    return [];
  }

  // N must be >= finalUnits (we can't undershoot)
  if (N < finalUnits) {
    memo.set(key, []);
    return [];
  }

  const G = N / L;
  const legalQs = legalQualifierCounts(G, L);
  const paths: BRPath[] = [];

  for (const Q of legalQs) {
    const nextN = G * Q;

    // Must reduce (actual elimination)
    if (nextN >= N) continue;

    // Next stage must be valid
    if (nextN < finalUnits) continue;
    if (nextN % L !== 0) continue;

    // Recurse into next stage
    const tails = searchBRPaths(nextN, L, finalUnits, roundsLeft - 1, roundNumber + 1, memo);

    for (const tail of tails) {
      paths.push({
        stages: [
          {
            roundNumber,
            lobbyUnits: N,
            groupCount: G,
            qualifiersPerGroup: Q,
            nextLobbyUnits: nextN,
            isFinal: false,
          },
          ...tail.stages,
        ],
        totalRounds: 1 + tail.totalRounds,
      });
    }
  }

  memo.set(key, paths);
  return paths;
}

/**
 * Entry point for BR path search.
 * Returns paths filtered by maxRounds and exactRounds.
 */
export function findBRPaths(params: {
  registrationUnitCount: number;
  mode: { unitsPerLobby: number; finalUnits: number };
  maxRounds: number;
  exactRounds: boolean;
}): BRPath[] {
  const { registrationUnitCount: N, mode, maxRounds, exactRounds } = params;
  const { unitsPerLobby: L, finalUnits } = mode;

  const memo = new Map<string, BRPath[]>();
  const allPaths = searchBRPaths(N, L, finalUnits, maxRounds, 1, memo);

  if (exactRounds) {
    return allPaths.filter((p) => p.totalRounds === maxRounds);
  }
  return allPaths.filter((p) => p.totalRounds <= maxRounds);
}
