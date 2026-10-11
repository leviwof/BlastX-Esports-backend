import { getModeConfig, TournamentMode } from './mode-registry';
import { findBRPaths, BRPath } from './br-math';
import { buildClashBracket, isValidClashCapacity, nearestClashCapacities } from './clash-squad-engine';
import { validateBRPath } from './format-validator';

export interface RecommendRequest {
  mode: TournamentMode;
  registrationUnitCount: number;
  maxRounds: number;
  exactRounds: boolean;
}

export interface StagePreview {
  round: number;
  units: number;
  groups: number;
  qualifyPerGroup: number;
  isFinal: boolean;
}

export interface ValidAlternative {
  capacity: number;
  stages: StagePreview[];
  totalRounds: number;
}

export interface RecommendResult {
  status: 'VALID' | 'NO_VALID_FORMAT';
  mode: TournamentMode;
  requestedCapacity: number;
  // Populated when VALID:
  paths?: BRPath[];
  previewPaths?: StagePreview[][];
  // Populated when NO_VALID_FORMAT:
  reasonCode?: string;
  explanation?: string;
  alternatives?: ValidAlternative[];
}

function pathToPreview(path: BRPath): StagePreview[] {
  return path.stages.map((s) => ({
    round: s.roundNumber,
    units: s.lobbyUnits,
    groups: s.groupCount,
    qualifyPerGroup: s.qualifiersPerGroup,
    isFinal: s.isFinal,
  }));
}

function findAlternatives(
  mode: TournamentMode,
  requestedN: number,
  maxRounds: number,
): ValidAlternative[] {
  const config = getModeConfig(mode);
  const L = config.unitsPerLobby;
  const alternatives: ValidAlternative[] = [];

  // Search ±10 multiples of L around requested capacity
  const range = Array.from({ length: 20 }, (_, i) => requestedN - (10 - i) * L)
    .concat(Array.from({ length: 10 }, (_, i) => requestedN + (i + 1) * L))
    .filter((n) => n >= config.finalUnits && n !== requestedN && n % L === 0)
    .sort((a, b) => Math.abs(a - requestedN) - Math.abs(b - requestedN));

  const seenCapacities = new Set<number>();

  for (const n of range) {
    if (seenCapacities.has(n)) continue;
    seenCapacities.add(n);

    const paths = findBRPaths({ registrationUnitCount: n, mode: config, maxRounds, exactRounds: false });
    const validPaths = paths.filter((p) => validateBRPath(p, mode).valid);
    if (validPaths.length > 0) {
      // Take the shortest valid path as the representative
      const best = validPaths.sort((a, b) => a.totalRounds - b.totalRounds)[0];
      alternatives.push({
        capacity: n,
        stages: pathToPreview(best),
        totalRounds: best.totalRounds,
      });
      if (alternatives.length >= 4) break;
    }
  }

  return alternatives.sort((a, b) => Math.abs(a.capacity - requestedN) - Math.abs(b.capacity - requestedN));
}

function findClashAlternatives(requestedN: number): ValidAlternative[] {
  const { lower, higher } = nearestClashCapacities(requestedN);
  const result: ValidAlternative[] = [];
  for (const n of [lower, higher]) {
    if (!n) continue;
    const bracket = buildClashBracket(n);
    result.push({
      capacity: n,
      stages: bracket.rounds.map((r) => ({
        round: r.roundNumber,
        units: r.teamsRemaining,
        groups: r.matchCount,
        qualifyPerGroup: 1,
        isFinal: r.teamsRemaining === 2,
      })),
      totalRounds: bracket.totalRounds,
    });
  }
  return result;
}

export function recommendFormats(req: RecommendRequest): RecommendResult {
  const config = getModeConfig(req.mode);

  if (config.strategy === 'CLASH_SQUAD') {
    if (!isValidClashCapacity(req.registrationUnitCount)) {
      return {
        status: 'NO_VALID_FORMAT',
        mode: req.mode,
        requestedCapacity: req.registrationUnitCount,
        reasonCode: 'NOT_POWER_OF_TWO',
        explanation: `Clash Squad strict single-elimination requires a power-of-2 capacity. ${req.registrationUnitCount} is not a power of 2.`,
        alternatives: findClashAlternatives(req.registrationUnitCount),
      };
    }
    const bracket = buildClashBracket(req.registrationUnitCount);
    return {
      status: 'VALID',
      mode: req.mode,
      requestedCapacity: req.registrationUnitCount,
      previewPaths: [
        bracket.rounds.map((r) => ({
          round: r.roundNumber,
          units: r.teamsRemaining,
          groups: r.matchCount,
          qualifyPerGroup: 1,
          isFinal: r.teamsRemaining === 2,
        })),
      ],
    };
  }

  // BR modes
  const N = req.registrationUnitCount;
  const L = config.unitsPerLobby;

  if (N % L !== 0) {
    return {
      status: 'NO_VALID_FORMAT',
      mode: req.mode,
      requestedCapacity: N,
      reasonCode: 'NOT_DIVISIBLE_BY_LOBBY_SIZE',
      explanation: `${N} ${config.unitLabel}s cannot form equal lobbies of ${L}. ${N} is not divisible by ${L}.`,
      alternatives: findAlternatives(req.mode, N, req.maxRounds),
    };
  }

  if (N < config.finalUnits) {
    return {
      status: 'NO_VALID_FORMAT',
      mode: req.mode,
      requestedCapacity: N,
      reasonCode: 'BELOW_FINAL_SIZE',
      explanation: `${N} is less than the minimum required for a final lobby (${config.finalUnits} ${config.unitLabel}s).`,
      alternatives: [],
    };
  }

  if (N === config.finalUnits) {
    // Single-stage final — already at final size
    return {
      status: 'VALID',
      mode: req.mode,
      requestedCapacity: N,
      previewPaths: [[{ round: 1, units: N, groups: 1, qualifyPerGroup: 0, isFinal: true }]],
    };
  }

  const allPaths = findBRPaths({ registrationUnitCount: N, mode: config, maxRounds: req.maxRounds, exactRounds: req.exactRounds });
  const validPaths = allPaths.filter((p) => validateBRPath(p, req.mode).valid);

  if (validPaths.length === 0) {
    const G = N / L;
    return {
      status: 'NO_VALID_FORMAT',
      mode: req.mode,
      requestedCapacity: N,
      reasonCode: 'NO_COMPLETE_QUALIFICATION_PATH',
      explanation: `${G} groups of ${L} cannot eliminate equally and reach a ${config.finalUnits}-unit final within ${req.maxRounds} rounds.`,
      alternatives: findAlternatives(req.mode, N, req.maxRounds),
    };
  }

  return {
    status: 'VALID',
    mode: req.mode,
    requestedCapacity: N,
    paths: validPaths,
    previewPaths: validPaths.map(pathToPreview),
  };
}
