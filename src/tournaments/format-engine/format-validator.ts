import { BRPath } from './br-math';
import { getModeConfig, TournamentMode } from './mode-registry';
import { isValidClashCapacity } from './clash-squad-engine';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a single BR path.
 * Checks every stage transition for divisibility, group count, and qualifier count.
 */
export function validateBRPath(path: BRPath, mode: TournamentMode): ValidationResult {
  const config = getModeConfig(mode);
  const L = config.unitsPerLobby;
  const finalUnits = config.finalUnits;
  const errors: string[] = [];

  for (let i = 0; i < path.stages.length; i++) {
    const stage = path.stages[i];

    if (!stage.isFinal) {
      // N must be divisible by L
      if (stage.lobbyUnits % L !== 0) {
        errors.push(`Stage ${stage.roundNumber}: ${stage.lobbyUnits} is not divisible by lobby size ${L}`);
      }

      // G must be correct
      const expectedG = stage.lobbyUnits / L;
      if (stage.groupCount !== expectedG) {
        errors.push(`Stage ${stage.roundNumber}: groupCount ${stage.groupCount} !== ${stage.lobbyUnits}/${L} = ${expectedG}`);
      }

      // nextN must be correct
      const expectedNext = stage.groupCount * stage.qualifiersPerGroup;
      if (stage.nextLobbyUnits !== expectedNext) {
        errors.push(`Stage ${stage.roundNumber}: nextLobbyUnits ${stage.nextLobbyUnits} !== ${stage.groupCount}*${stage.qualifiersPerGroup} = ${expectedNext}`);
      }

      // nextN must be divisible by L
      if (stage.nextLobbyUnits % L !== 0) {
        errors.push(`Stage ${stage.roundNumber}: next stage ${stage.nextLobbyUnits} is not divisible by L=${L}`);
      }

      // nextN must be smaller (actual elimination)
      if (stage.nextLobbyUnits >= stage.lobbyUnits) {
        errors.push(`Stage ${stage.roundNumber}: no elimination — nextLobbyUnits ${stage.nextLobbyUnits} >= ${stage.lobbyUnits}`);
      }

      // nextN must be at least finalUnits
      if (stage.nextLobbyUnits < finalUnits) {
        errors.push(`Stage ${stage.roundNumber}: nextLobbyUnits ${stage.nextLobbyUnits} < finalUnits ${finalUnits}`);
      }
    } else {
      // Final stage
      if (stage.lobbyUnits !== finalUnits) {
        errors.push(`Final stage: lobbyUnits ${stage.lobbyUnits} !== finalUnits ${finalUnits}`);
      }
    }
  }

  // Last stage must be final
  const lastStage = path.stages[path.stages.length - 1];
  if (!lastStage || !lastStage.isFinal) {
    errors.push('Path does not end in a final stage');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a Clash Squad capacity for strict no-bye single elimination.
 */
export function validateClashCapacity(n: number): ValidationResult {
  if (!isValidClashCapacity(n)) {
    return {
      valid: false,
      errors: [`${n} is not a valid Clash Squad capacity. Must be a power of 2 (e.g. 8, 16, 32, 64).`],
    };
  }
  return { valid: true, errors: [] };
}
