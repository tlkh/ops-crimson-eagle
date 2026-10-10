import musicCredits from '../docs/music-credits.json';
import type { Mission, Phase, SimState } from './types';

export const musicTracks = musicCredits.tracks;
export type MusicTrackId = keyof typeof musicTracks;

const PHASE_MUSIC_LEVEL: Record<Phase, number> = {
  prepare: 0.72,
  deck_rig: 0.72,
  shore_rig: 0.72,
  depart: 0.78,
  transit: 0.84,
  work: 0.86,
  return: 0.80,
  shore_unrig: 0.76,
  land: 0.74,
  debrief: 0.78,
  failed: 0.70,
};

/** Keep the fire run as the high point without changing the player's music setting. */
export function musicLevelFor(state: SimState | null, mission: Mission | null): number {
  if (!state) return 0.82;
  const base = PHASE_MUSIC_LEVEL[state.phase];
  if (state.phase !== 'work' || !mission || (state.waterLitres <= 50 && state.airborneLitres <= 50)) return base;
  const distance = Math.hypot(state.position.x - mission.fire.x, state.position.z - mission.fire.z);
  const proximity = Math.max(0, Math.min(1, (mission.fire.radius + 240 - distance) / 240));
  return base + 0.14 * proximity;
}
