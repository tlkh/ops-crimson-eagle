import type { Campaign, CampaignId, Mission } from '../types';

/** The authored coastline and terrain remain fixed while the ship moves per sortie. */
export const CAMPAIGN_TERRAIN_ORIGIN = Object.freeze({ x: 0, z: 0 });

/** Original scenario landmarks define a stable inland direction for each campaign. */
export const CAMPAIGN_TERRAIN_AXIS_ANCHORS: Readonly<Record<CampaignId, Readonly<{ x: number; z: number }>>> = Object.freeze({
  sg_fictional_2026_10: Object.freeze({ x: 220, z: 1485 }),
  jp_ketapang_2026_09: Object.freeze({ x: 120, z: 400 }),
});

export function campaignTerrainAnchor(_campaign: Pick<Campaign, 'id'>): Readonly<{ x: number; z: number }> {
  return CAMPAIGN_TERRAIN_ORIGIN;
}

export function campaignTerrainAxisAnchor(campaign: Pick<Campaign, 'id'>): Readonly<{ x: number; z: number }> {
  return CAMPAIGN_TERRAIN_AXIS_ANCHORS[campaign.id];
}

/** Local +T runs inland; +S is its left-hand perpendicular. */
/** Mission is accepted for call-site compatibility; authored geometry never changes the terrain basis. */
export function campaignTerrainFrame(campaign: Campaign, _mission?: Mission) {
  const origin = campaignTerrainAnchor(campaign);
  const target = campaignTerrainAxisAnchor(campaign);
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const length = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / length, uz = dz / length, sx = -uz, sz = ux;
  return { origin, length, ux, uz, sx, sz };
}
