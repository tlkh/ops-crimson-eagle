import type { Campaign, Mission } from '../types';

/** The authored coastline and terrain remain fixed while the ship moves per sortie. */
export const CAMPAIGN_TERRAIN_ORIGIN = Object.freeze({ x: 0, z: 0 });
export function campaignTerrainAnchor(_campaign: Pick<Campaign, 'id'>): Readonly<{ x: number; z: number }> {
  return CAMPAIGN_TERRAIN_ORIGIN;
}

/** Local +T runs inland; +S is its left-hand perpendicular. */
export function campaignTerrainFrame(campaign: Campaign, mission: Mission) {
  const origin = campaignTerrainAnchor(campaign);
  const target = mission.shore ?? mission.lake;
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const length = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / length, uz = dz / length, sx = -uz, sz = ux;
  return { origin, length, ux, uz, sx, sz };
}
