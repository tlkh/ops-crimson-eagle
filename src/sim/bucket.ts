import type { Campaign, Mission, SimState, Vec3 } from '../types';
import { renderedTerrainHeight } from './collision';

/** `state.bucket` is the center of the open rim, in world coordinates. */
export const BUCKET_BODY_HEIGHT_M = 1.48;
export const BUCKET_LIFT_OFFSET_M = 0.85;
export const BUCKET_HOOK_OFFSET_M = 1.76;
export const SLING_LENGTH_M = 22;
export const LAKE_SURFACE_M = 0.025;
/** The soft bucket floats with its rim just above the lake surface. */
export const BUCKET_FLOAT_RIM_M = 0.25;
/** Small allowance for the bucket's lower rim to clear the water surface. */
export const BUCKET_WATER_CONTACT_TOLERANCE_M = 0.2;

/** True when the bucket's lower rim reaches the freshwater lake surface. */
export function isBucketTouchingLake(
  bucket: Pick<Vec3, 'x' | 'y' | 'z'>,
  mission: Mission,
  toleranceM = BUCKET_WATER_CONTACT_TOLERANCE_M,
): boolean {
  const withinLake = Math.hypot(bucket.x - mission.lake.x, bucket.z - mission.lake.z) <= mission.lake.radius;
  const bottomRimY = bucket.y - BUCKET_BODY_HEIGHT_M;
  return withinLake && bottomRimY <= LAKE_SURFACE_M + Math.max(0, toleranceM);
}

/** The aircraft's modeled belly hook, transformed by its YXZ attitude. */
export function getBucketHook(state: Pick<SimState, 'position' | 'heading' | 'pitch' | 'bank'>): Vec3 {
  const h = BUCKET_HOOK_OFFSET_M;
  const lateral = h * Math.sin(state.bank);
  const longitudinal = h * Math.cos(state.bank) * Math.sin(state.pitch);
  return {
    x: state.position.x + lateral * Math.cos(state.heading) + longitudinal * Math.sin(state.heading),
    y: state.position.y - h * Math.cos(state.bank) * Math.cos(state.pitch),
    z: state.position.z - lateral * Math.sin(state.heading) + longitudinal * Math.cos(state.heading),
  };
}

/** Actual visible contact surface under a bucket: deck, freshwater, land, or sea. */
export function bucketSurfaceHeight(campaign: Campaign, mission: Mission, x: number, z: number): number {
  const localX = x - mission.ship.x;
  const localZ = z - mission.ship.z;
  const stern = campaign.id === 'jp_ketapang_2026_09' ? 40 : 35;
  if (Math.abs(localX) <= campaign.shipWidth / 2 &&
    localZ >= stern - campaign.shipLength && localZ <= stern) return -2.525;
  // ships.ts builds the deck at -2.55 plus its .025 m top skin. Aircraft
  // origin zero is its landed pose, not the actual surface under the bucket.
  if (Math.hypot(x - mission.lake.x, z - mission.lake.z) <= mission.lake.radius) return LAKE_SURFACE_M;
  if (mission.shore) {
    // Match the rotated handling pad, apron, runway and taxiways in world.ts.
    const routeX = mission.shore.x - mission.ship.x, routeZ = mission.shore.z - mission.ship.z;
    const length = Math.max(1, Math.hypot(routeX, routeZ));
    const dx = x - mission.shore.x, dz = z - mission.shore.z;
    const px = (dx * routeZ - dz * routeX) / length;
    const pz = (dx * routeX + dz * routeZ) / length;
    if ((Math.abs(px) <= 30 && Math.abs(pz) <= 15) ||
      (Math.abs(px - 105) <= 112 && Math.abs(pz - 74) <= 25.5) ||
      (Math.abs(px - 235) <= 15 && Math.abs(pz - 380) <= 500) ||
      (Math.abs(px - 180) <= 50 && (Math.abs(pz + 60) <= 9 || Math.abs(pz - 740) <= 9))) return 0;
  }
  const terrain = renderedTerrainHeight(campaign, mission, x, z);
  if (terrain !== null) return terrain;
  return -9;
}

/** Lowest plausible rim center, accounting for the bucket body and lake flotation. */
export function bucketMinimumRimHeight(campaign: Campaign, mission: Mission, x: number, z: number): number {
  const lake = Math.hypot(x - mission.lake.x, z - mission.lake.z) <= mission.lake.radius;
  if (lake) return BUCKET_FLOAT_RIM_M;
  // Sample the footprint so a slope cannot poke through the soft body.
  let surface = -Infinity;
  for (const [dx, dz] of [[0, 0], [-1.18, 0], [1.18, 0], [0, -1.18], [0, 1.18]]) {
    surface = Math.max(surface, bucketSurfaceHeight(campaign, mission, x + dx, z + dz));
  }
  return surface + BUCKET_BODY_HEIGHT_M;
}
