import { shipLandingPoint } from '../../src/sim/shipLanding';
import { bucketReadyForDeckRecovery } from '../../src/sim/bucket';
import { shouldObserveFire } from '../../src/sim/fireWork';
import { getCampaign, getMission } from '../../src/content';
import { createSim, distance2D, getObjectiveAction, stepSim } from '../../src/sim';
import type { ExtendedSimState } from '../../src/sim/types';
import type { CampaignId, FlightCommand, Marker, SimState } from '../../src/types';

const idle: FlightCommand = { yaw: 0, climb: 0, cyclicX: 0, cyclicY: 0, drop: false, fetch: false, faceObjective: false, returnHome: false, action: false };
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

// A test-only pilot. Production controls never use this waypoint flight logic.
function flyTo(state: SimState, marker: Marker, altitude: number, maxSpeed: number): FlightCommand {
  const dx = marker.x - state.position.x;
  const dz = marker.z - state.position.z;
  const distance = Math.hypot(dx, dz);
  const desiredSpeed = Math.min(maxSpeed, Math.sqrt(distance * 10));
  const desiredX = distance > 0.01 ? dx / distance * desiredSpeed : 0;
  const desiredZ = distance > 0.01 ? dz / distance * desiredSpeed : 0;
  const ax = clamp((desiredX - state.velocity.x) * 0.9, -7, 7);
  const az = clamp((desiredZ - state.velocity.z) * 0.9, -7, 7);
  const forwardX = -Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  const rightX = Math.cos(state.heading);
  const rightZ = -Math.sin(state.heading);
  const desiredHeading = Math.atan2(-dx, -dz);
  const headingError = Math.atan2(Math.sin(desiredHeading - state.heading), Math.cos(desiredHeading - state.heading));
  return {
    ...idle,
    yaw: distance > 35 ? clamp(headingError * 1.4, -1, 1) : 0,
    cyclicX: clamp((ax * rightX + az * rightZ) / 7, -1, 1),
    cyclicY: clamp((ax * forwardX + az * forwardZ) / 7, -1, 1),
    climb: clamp((altitude - state.position.y) * 0.14 - state.velocity.y * 0.25, -1, 1),
  };
}

export function recordSortie(campaignId: CampaignId, missionId: string) {
  const campaign = getCampaign(campaignId)!;
  const mission = getMission(campaignId, missionId)!;
  const state = createSim(campaign, mission) as ExtendedSimState;
  const japanese = campaignId === 'jp_ketapang_2026_09';
  const deck = { ...mission.ship, ...shipLandingPoint(campaign, mission) };
  const shore = mission.shore ?? mission.ship;
  const frames: ExtendedSimState[] = [structuredClone(state)];
  let lastAction: string | null = null;
  let maxTick = 60 * 400;
  for (let tick = 0; tick < maxTick && state.phase !== 'debrief' && state.phase !== 'failed'; tick++) {
    const available = getObjectiveAction(state, campaign, mission);
    let cmd = { ...idle };
    if (state.precisionAction || state.fetching || state.rigProgress > 0 || state.dumping ||
      shouldObserveFire(state, mission)) {
      // Allow local correction, rigging, filling and dumping to finish.
    } else if (available && available !== lastAction) {
      if (available === 'fetch') cmd.fetch = true;
      else if (available === 'release') cmd.drop = true;
      else cmd.action = true;
      lastAction = available;
    } else {
      const homeward = ['return', 'shore_unrig', 'land'].includes(state.phase);
      const destination = state.phase === 'shore_rig' || (homeward && japanese && state.bucketAttached)
        ? shore
        : homeward ? deck
          : japanese && state.phase === 'depart' && !state.bucketAttached ? shore
            : state.waterLitres >= 4_500 ? mission.fire : mission.lake;
      const targetAltitude = destination === deck || destination === shore ? 0 :
        destination === mission.fire ? 55 : 25;
      const distance = distance2D(state.position, destination);
      // Start the lake descent before arriving at its shore. The lake and its
      // clear margin give the pilot room to lower a suspended load safely.
      const descentRange = destination === mission.lake ? mission.lake.radius + 160 : 100;
      const deckApproach = destination === deck && !japanese && state.bucketAttached;
      const readyToDescend = !deckApproach || (distance <= 4 && bucketReadyForDeckRecovery(state, campaign, mission));
      const approachAltitude = distance <= descentRange && readyToDescend ? targetAltitude : Math.max(targetAltitude, 60);
      cmd = flyTo(state, destination, approachAltitude,
        state.bucketAttached ? 48 : 55);
      if (!available) lastAction = null;
    }
    stepSim(state, cmd, campaign, mission);
    if (tick % 2 === 1) frames.push(structuredClone(state));
  }
  if (state.outcome !== 'success') throw new Error(`${missionId}: ${state.phase} at ${state.timeSec}s: ${state.message}`);
  return { campaign, mission, frames, result: structuredClone(state) };
}
