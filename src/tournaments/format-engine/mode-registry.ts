export type TournamentMode = 'SQUAD_BR' | 'DUO_BR' | 'SOLO_BR' | 'CLASH_SQUAD';

export interface ModeConfig {
  mode: TournamentMode;
  unitsPerLobby: number;       // Number of registration units in one full lobby
  finalUnits: number;          // Number of units in the final stage
  activePlayersPerUnit: number; // Players fielded per registration unit
  strategy: 'BATTLE_ROYALE' | 'CLASH_SQUAD';
  unitLabel: string;           // 'team' | 'duo' | 'player'
}

export const MODE_REGISTRY: Record<TournamentMode, ModeConfig> = {
  SQUAD_BR: {
    mode: 'SQUAD_BR',
    unitsPerLobby: 12,
    finalUnits: 12,
    activePlayersPerUnit: 4,
    strategy: 'BATTLE_ROYALE',
    unitLabel: 'team',
  },
  DUO_BR: {
    mode: 'DUO_BR',
    unitsPerLobby: 24,
    finalUnits: 24,
    activePlayersPerUnit: 2,
    strategy: 'BATTLE_ROYALE',
    unitLabel: 'duo',
  },
  SOLO_BR: {
    mode: 'SOLO_BR',
    unitsPerLobby: 48,
    finalUnits: 48,
    activePlayersPerUnit: 1,
    strategy: 'BATTLE_ROYALE',
    unitLabel: 'player',
  },
  CLASH_SQUAD: {
    mode: 'CLASH_SQUAD',
    unitsPerLobby: 2,
    finalUnits: 2,
    activePlayersPerUnit: 4,
    strategy: 'CLASH_SQUAD',
    unitLabel: 'team',
  },
};

export function getModeConfig(mode: TournamentMode): ModeConfig {
  const config = MODE_REGISTRY[mode];
  if (!config) throw new Error(`Unknown mode: ${mode}`);
  return config;
}

/**
 * Derive TournamentMode from existing Prisma TournamentFormat + TeamMode enums
 * for backwards compatibility with existing tournaments.
 */
export function deriveModeFromPrisma(
  format: 'BATTLE_ROYALE' | 'CLASH_SQUAD',
  teamMode: 'SOLO' | 'DUO' | 'SQUAD',
): TournamentMode {
  if (format === 'CLASH_SQUAD') return 'CLASH_SQUAD';
  if (teamMode === 'SOLO') return 'SOLO_BR';
  if (teamMode === 'DUO') return 'DUO_BR';
  return 'SQUAD_BR';
}
