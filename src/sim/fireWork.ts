import type { Mission, SimState } from '../types';

const WATER_EPSILON_L = 1e-8;

/**
 * True while a released load still needs to be observed, or while the final
 * suppression has reached the point where crews can finish without another
 * water load. This keeps guidance on the fire until the next objective is real.
 */
export function shouldObserveFire(state: SimState, mission: Mission): boolean {
  if (state.phase !== 'work' && state.phase !== 'transit') return false;

  const extended = state as SimState & {
    dumping?: boolean;
    waterPackets?: unknown[];
  };
  const impactPending = !!extended.dumping ||
    (Array.isArray(extended.waterPackets) && extended.waterPackets.length > 0) ||
    state.airborneLitres > WATER_EPSILON_L;
  if (impactPending) return true;

  if (state.objectiveSaved || state.dropsCompleted < mission.requiredDrops) return false;

  // Peat heat is finished by the ground crew after surface suppression; a
  // non-peat line needs to cool to the final fireHeat threshold first.
  return mission.peat ? state.fireHeat <= 30 : state.fireHeat <= 8;
}
