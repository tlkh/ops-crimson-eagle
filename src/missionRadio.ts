import { bucketReadyForDeckRecovery } from './sim/bucket';
import { estimateLandingFuel, getObjectiveAction } from './sim';
import { shouldObserveFire } from './sim/fireWork';
import type { ExtendedSimState } from './sim/types';
import type { Campaign, Mission, SimState } from './types';

export type RadioPriority = 'hint' | 'event' | 'urgent';
export type RadioTransmission = { id: string; priority: RadioPriority };

const APPROACH_CUE_RANGE_M = 200;
const GUIDANCE_REPEAT_SEC = 24;
const MIN_HINT_GAP_SEC = 8;

type Snapshot = {
  tick: number;
  phase: SimState['phase'];
  outcome: SimState['outcome'];
  bucketAttached: boolean;
  waterLitres: number;
  usefulLitres: number;
  airborneLitres: number;
  dropsCompleted: number;
  dropId: number;
  objectiveSaved: boolean;
  fuelKg: number;
  landingFuel: number;
  damage: number;
  fetching: boolean;
  dumping: boolean;
  message: string;
};

function snapshot(state: SimState, campaign: Campaign, mission: Mission): Snapshot {
  const extended = state as ExtendedSimState;
  return {
    tick: state.tick,
    phase: state.phase,
    outcome: state.outcome,
    bucketAttached: state.bucketAttached,
    waterLitres: state.waterLitres,
    usefulLitres: state.usefulLitres,
    airborneLitres: state.airborneLitres,
    dropsCompleted: state.dropsCompleted,
    dropId: extended.dropId ?? state.dropsCompleted,
    objectiveSaved: state.objectiveSaved,
    fuelKg: state.fuelKg,
    landingFuel: estimateLandingFuel(state, campaign, mission),
    damage: state.damage,
    fetching: !!extended.fetching,
    dumping: !!extended.dumping,
    message: state.message,
  };
}

/** Mirrors the visible objective's approach advice without speaking changing distances. */
export function guidanceVoiceCue(state: SimState, campaign: Campaign, mission: Mission): string | null {
  if (state.phase === 'debrief' || state.phase === 'failed') return null;
  const japan = campaign.id === 'jp_ketapang_2026_09';
  const extended = state as ExtendedSimState;
  const guidance = extended.guidance;
  const action = getObjectiveAction(state, campaign, mission);
  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  if (extended.dumping) return 'water_released';
  if (extended.fetching) return 'bucket_filling';
  if (action === 'deck-rig') return 'sg_attach_deck';
  if (action === 'deck-recover') return 'sg_secure_bucket';
  if (action === 'attach') return 'jp_attach_shore';
  if (action === 'unrig') return 'jp_remove_sling';
  if (action === 'fetch') {
    if (state.position.y > 28) return 'lake_descend';
    if (state.position.y < 22) return 'lake_climb';
    if (speed > 12) return 'lake_slow';
    return 'fetch_water';
  }
  if (action === 'release') {
    if (state.position.y < 38 || state.position.y > 70) return 'fire_altitude';
    if (speed > 3.5) return 'fire_slow';
    return 'release_water';
  }
  if (shouldObserveFire(state, mission)) return 'fire_cooling';

  if (guidance && guidance.distanceM < APPROACH_CUE_RANGE_M) {
    if (guidance.label === 'Freshwater lake' && state.bucketAttached) {
      if (speed > 12) return 'lake_slow';
      if (state.position.y > 28) return 'lake_descend';
      if (state.position.y < 22) return 'lake_climb';
      return 'lake_align';
    }
    if (guidance.label === 'Active fire' && state.waterLitres > 0) {
      if (state.position.y < 38 || state.position.y > 70) return 'fire_altitude';
      if (speed > 3.5) return 'fire_slow';
      return 'fire_align';
    }
    if (['deck_rig', 'shore_rig', 'shore_unrig', 'land', 'return'].includes(state.phase)) {
      if (!japan && state.bucketAttached && ['return', 'land'].includes(state.phase) &&
        (!bucketReadyForDeckRecovery(state, campaign, mission) || guidance.distanceM > 5)) return 'sg_return_ship';
      if (state.position.y > 10) return 'landing_descend';
      if (speed > 10) return 'landing_slow';
      return 'landing_settle';
    }
  }

  if (state.phase === 'deck_rig') return state.bucketAttached ? 'sg_secure_bucket' : 'sg_attach_deck';
  if (state.phase === 'shore_rig') return 'jp_attach_shore';
  if (state.phase === 'shore_unrig') return 'jp_remove_sling';
  if (state.phase === 'depart' && japan) return 'jp_go_shore';
  if (state.phase === 'return' || state.phase === 'land') {
    return japan ? (state.bucketAttached ? 'jp_return_shore' : 'jp_return_ship') : 'sg_return_ship';
  }
  if (guidance?.label === 'Active fire') return 'go_fire';
  if (guidance?.label === 'Freshwater lake') return 'go_lake';
  return null;
}

/** Sends only meaningful state edges, then occasional current-objective guidance. */
export class MissionRadioDirector {
  private previous: Snapshot | null = null;
  private missionKey = '';
  private lastGuidance: string | null = null;
  private lastGuidanceAt = -Infinity;
  private lastTransmissionAt = -Infinity;
  private lastCoolingDrop = -1;
  private readonly send: (transmission: RadioTransmission) => void;

  constructor(send: (transmission: RadioTransmission) => void) { this.send = send; }

  reset(state: SimState, campaign: Campaign, mission: Mission): void {
    this.missionKey = `${campaign.id}/${mission.id}`;
    this.previous = snapshot(state, campaign, mission);
    this.lastGuidance = null;
    this.lastGuidanceAt = -Infinity;
    this.lastTransmissionAt = -Infinity;
    this.lastCoolingDrop = -1;
    const initial = guidanceVoiceCue(state, campaign, mission);
    if (initial) this.speak(initial, 'event', state.timeSec);
  }

  clear(): void {
    this.previous = null;
    this.missionKey = '';
    this.lastGuidance = null;
  }

  private speak(id: string, priority: RadioPriority, timeSec: number): void {
    this.send({ id, priority });
    this.lastTransmissionAt = timeSec;
    this.lastGuidance = id;
    this.lastGuidanceAt = timeSec;
  }

  update(state: SimState, campaign: Campaign, mission: Mission): void {
    const key = `${campaign.id}/${mission.id}`;
    if (key !== this.missionKey || !this.previous || state.tick < this.previous.tick) {
      this.reset(state, campaign, mission);
      return;
    }
    if (state.tick === this.previous.tick) return;
    const before = this.previous;
    const after = snapshot(state, campaign, mission);
    this.previous = after;
    const japan = campaign.id === 'jp_ketapang_2026_09';

    let event: RadioTransmission | null = null;
    if (after.outcome === 'failed' && before.outcome !== 'failed') {
      event = { id: after.fuelKg <= 0 ? 'fuel_exhausted' : after.damage >= 100 && !(state as ExtendedSimState).failureCause ? 'aircraft_damaged' : 'aircraft_lost', priority: 'urgent' };
    } else if (after.phase === 'debrief' && before.phase !== 'debrief') {
      event = { id: 'sortie_complete', priority: 'event' };
    } else if (after.fuelKg <= 0 && before.fuelKg > 0) {
      event = { id: 'fuel_exhausted', priority: 'urgent' };
    } else if (after.fuelKg <= 350 && before.fuelKg > 350) {
      event = { id: 'fuel_critical', priority: 'urgent' };
    } else if (after.landingFuel <= 150 && before.landingFuel > 150 && after.phase !== 'return' && after.phase !== 'land') {
      event = { id: 'return_fuel_low', priority: 'urgent' };
    } else if (after.objectiveSaved && !before.objectiveSaved) {
      event = { id: 'fire_secured', priority: 'event' };
    } else if (!after.bucketAttached && before.bucketAttached) {
      event = { id: japan ? 'jp_return_ship' : 'sg_secure_bucket', priority: 'event' };
    } else if (after.bucketAttached && !before.bucketAttached) {
      event = { id: japan ? 'jp_sling_attached' : 'sg_bucket_rigged', priority: 'event' };
    } else if (after.message.startsWith('Maximum safe load reached') && !before.message.startsWith('Maximum safe load reached')) {
      event = { id: 'load_limit', priority: 'event' };
    } else if (after.waterLitres >= 5000 && before.waterLitres < 5000) {
      event = { id: 'bucket_full', priority: 'event' };
    } else if (after.dumping && !before.dumping) {
      event = { id: 'water_released', priority: 'event' };
    } else if (after.usefulLitres > before.usefulLitres && this.lastCoolingDrop !== after.dropId) {
      this.lastCoolingDrop = after.dropId;
      event = { id: 'fire_cooling', priority: 'event' };
    } else if (before.airborneLitres > 50 && after.airborneLitres <= 50 && after.waterLitres < 50 &&
      !after.objectiveSaved && !shouldObserveFire(state, mission)) {
      event = { id: 'another_load', priority: 'event' };
    } else if (after.waterLitres > before.waterLitres && before.waterLitres < 50 && after.fetching) {
      event = { id: 'bucket_filling', priority: 'event' };
    }
    if (event) {
      this.speak(event.id, event.priority, state.timeSec);
      return;
    }

    const cue = guidanceVoiceCue(state, campaign, mission);
    if (cue && (cue !== this.lastGuidance || state.timeSec - this.lastGuidanceAt >= GUIDANCE_REPEAT_SEC) &&
      state.timeSec - this.lastTransmissionAt >= MIN_HINT_GAP_SEC) {
      this.speak(cue, 'hint', state.timeSec);
    }
  }
}
