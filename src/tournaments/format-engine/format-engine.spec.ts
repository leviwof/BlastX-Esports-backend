import { gcd, legalQualifierCounts, findBRPaths } from './br-math';
import { isValidClashCapacity, buildClashBracket, nearestClashCapacities } from './clash-squad-engine';
import { validateBRPath } from './format-validator';
import { recommendFormats } from './recommendation-engine';
import { getModeConfig } from './mode-registry';

describe('GCD', () => {
  it('gcd(12, 8) = 4', () => expect(gcd(12, 8)).toBe(4));
  it('gcd(12, 11) = 1', () => expect(gcd(12, 11)).toBe(1));
  it('gcd(48, 4) = 4', () => expect(gcd(48, 4)).toBe(4));
});

describe('legalQualifierCounts', () => {
  it('for 8 groups, lobby 12: step=12/gcd(12,8)=12/4=3 → [3,6,9]', () => {
    expect(legalQualifierCounts(8, 12)).toEqual([3, 6, 9]);
  });
  it('for 11 groups, lobby 12: step=12/gcd(12,11)=12 → [] (no valid Q < 12)', () => {
    expect(legalQualifierCounts(11, 12)).toEqual([]);
  });
  it('for 6 groups, lobby 24: step=24/gcd(24,6)=24/6=4 → [4,8,12,16,20]', () => {
    expect(legalQualifierCounts(6, 24)).toEqual([4, 8, 12, 16, 20]);
  });
});

describe('BR Path Search — Squad BR', () => {
  const squadConfig = getModeConfig('SQUAD_BR');

  it('96 Squad teams: finds at least 12 valid paths with maxRounds=5', () => {
    const paths = findBRPaths({ registrationUnitCount: 96, mode: squadConfig, maxRounds: 5, exactRounds: false });
    const valid = paths.filter((p) => validateBRPath(p, 'SQUAD_BR').valid);
    expect(valid.length).toBeGreaterThanOrEqual(12);
  });

  it('96 Squad teams includes route 96→24→12 (3 rounds)', () => {
    const paths = findBRPaths({ registrationUnitCount: 96, mode: squadConfig, maxRounds: 5, exactRounds: false });
    const threeRound = paths.filter((p) => p.totalRounds === 3);
    const has96to24to12 = threeRound.some(
      (p) => p.stages[0].lobbyUnits === 96 && p.stages[0].nextLobbyUnits === 24 && p.stages[1].nextLobbyUnits === 12 && p.stages[2].isFinal,
    );
    expect(has96to24to12).toBe(true);
  });

  it('96 Squad teams includes route 96→72→48→36→24→12 (5 rounds)', () => {
    const paths = findBRPaths({ registrationUnitCount: 96, mode: squadConfig, maxRounds: 5, exactRounds: false });
    const fiveRound = paths.filter((p) => p.totalRounds === 5);
    expect(fiveRound.length).toBeGreaterThan(0);
  });

  it('132 Squad teams returns NO_VALID_FORMAT', () => {
    const result = recommendFormats({ mode: 'SQUAD_BR', registrationUnitCount: 132, maxRounds: 5, exactRounds: false });
    expect(result.status).toBe('NO_VALID_FORMAT');
  });

  it('132 Squad teams alternatives are all independently valid', () => {
    const result = recommendFormats({ mode: 'SQUAD_BR', registrationUnitCount: 132, maxRounds: 5, exactRounds: false });
    expect(result.alternatives).toBeDefined();
    for (const alt of result.alternatives!) {
      // Every alternative must have stages ending in final
      expect(alt.stages[alt.stages.length - 1].isFinal).toBe(true);
    }
  });

  it('exactRounds=true with maxRounds=3 returns only 3-round paths for 96 teams', () => {
    const paths = findBRPaths({ registrationUnitCount: 96, mode: squadConfig, maxRounds: 3, exactRounds: true });
    const valid = paths.filter((p) => validateBRPath(p, 'SQUAD_BR').valid);
    expect(valid.every((p) => p.totalRounds === 3)).toBe(true);
  });
});

describe('BR Path Search — Duo BR', () => {
  const duoConfig = getModeConfig('DUO_BR');

  it('Duo BR uses 24 duos per lobby (not 12)', () => {
    expect(duoConfig.unitsPerLobby).toBe(24);
    expect(duoConfig.finalUnits).toBe(24);
  });

  it('144 Duo teams finds valid paths', () => {
    const paths = findBRPaths({ registrationUnitCount: 144, mode: duoConfig, maxRounds: 5, exactRounds: false });
    const valid = paths.filter((p) => validateBRPath(p, 'DUO_BR').valid);
    expect(valid.length).toBeGreaterThan(0);
  });
});

describe('BR Path Search — Solo BR', () => {
  const soloConfig = getModeConfig('SOLO_BR');

  it('Solo BR uses 48 players per lobby', () => {
    expect(soloConfig.unitsPerLobby).toBe(48);
  });

  it('192 Solo players finds valid paths', () => {
    const paths = findBRPaths({ registrationUnitCount: 192, mode: soloConfig, maxRounds: 5, exactRounds: false });
    const valid = paths.filter((p) => validateBRPath(p, 'SOLO_BR').valid);
    expect(valid.length).toBeGreaterThan(0);
  });
});

describe('Clash Squad Engine', () => {
  it('64 teams is valid (power of 2)', () => expect(isValidClashCapacity(64)).toBe(true));
  it('50 teams is invalid', () => expect(isValidClashCapacity(50)).toBe(false));
  it('2 teams is valid minimum', () => expect(isValidClashCapacity(2)).toBe(true));
  it('1 team is invalid', () => expect(isValidClashCapacity(1)).toBe(false));

  it('64 teams bracket: 6 rounds, first round 32 matches', () => {
    const bracket = buildClashBracket(64);
    expect(bracket.totalRounds).toBe(6);
    expect(bracket.rounds[0].matchCount).toBe(32);
    expect(bracket.rounds[0].teamsRemaining).toBe(64);
  });

  it('8 teams bracket: 3 rounds', () => {
    const bracket = buildClashBracket(8);
    expect(bracket.totalRounds).toBe(3);
    expect(bracket.rounds[2].teamsRemaining).toBe(2);
  });

  it('50 teams recommend returns NO_VALID_FORMAT with alternatives 32 and 64', () => {
    const result = recommendFormats({ mode: 'CLASH_SQUAD', registrationUnitCount: 50, maxRounds: 5, exactRounds: false });
    expect(result.status).toBe('NO_VALID_FORMAT');
    const caps = result.alternatives?.map((a) => a.capacity) ?? [];
    expect(caps).toContain(32);
    expect(caps).toContain(64);
  });
});

describe('Format Validator', () => {
  it('valid 96→48→12 Squad path passes validation', () => {
    const path = {
      stages: [
        { roundNumber: 1, lobbyUnits: 96, groupCount: 8, qualifiersPerGroup: 6, nextLobbyUnits: 48, isFinal: false },
        { roundNumber: 2, lobbyUnits: 48, groupCount: 4, qualifiersPerGroup: 3, nextLobbyUnits: 12, isFinal: false },
        { roundNumber: 3, lobbyUnits: 12, groupCount: 1, qualifiersPerGroup: 0, nextLobbyUnits: 0, isFinal: true },
      ],
      totalRounds: 3,
    };
    const result = validateBRPath(path, 'SQUAD_BR');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('invalid path with uneven groups fails validation', () => {
    const path = {
      stages: [
        { roundNumber: 1, lobbyUnits: 96, groupCount: 7, qualifiersPerGroup: 6, nextLobbyUnits: 42, isFinal: false },
        { roundNumber: 2, lobbyUnits: 42, groupCount: 1, qualifiersPerGroup: 0, nextLobbyUnits: 0, isFinal: true },
      ],
      totalRounds: 2,
    };
    const result = validateBRPath(path, 'SQUAD_BR');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
