import type { Mission, SimState } from '../types';
import type { ExtendedSimState } from './types';

/** Relocated objectives must not pull a resumed aircraft toward a former local action. */
export function clearRelocatedObjectiveActions(state: SimState, mission: Mission): void {
  const saved = state as SimState & Partial<ExtendedSimState>;
  const awayFromLake = Math.hypot(state.position.x - mission.lake.x, state.position.z - mission.lake.z) > 75;
  const awayFromFire = Math.hypot(state.position.x - mission.fire.x, state.position.z - mission.fire.z) > 75;
  if ((saved.precisionAction === 'fetch' && awayFromLake) ||
    (saved.precisionAction === 'release' && awayFromFire)) saved.precisionAction = null;
  if (saved.fetching && awayFromLake) saved.fetching = false;
  if (saved.faceObjectiveActive) saved.faceObjectiveActive = false;
}
