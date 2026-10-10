import type { Campaign, Mission, Vec3 } from '../types';

/** Painted aftmost helicopter landing guide on RSS Persistence. */
export const RSAF_FLIGHT_DECK_LANDING_Z_OFFSET_M = 17;
/** Kunisaki's painted aft flight-deck guide; mission.ship stays at the ship marker. */
export const JAPAN_FLIGHT_DECK_LANDING_Z_OFFSET_M = 20;

/** Local Z of the active painted flight-deck landing guide on each ship. */
export function shipLandingLocalZ(campaign: Pick<Campaign, 'id'>): number {
  return campaign.id === 'jp_ketapang_2026_09'
    ? JAPAN_FLIGHT_DECK_LANDING_Z_OFFSET_M
    : RSAF_FLIGHT_DECK_LANDING_Z_OFFSET_M;
}

/** Aircraft-origin landing point in world coordinates, with the ship marker unchanged. */
export function shipLandingPoint(
  campaign: Pick<Campaign, 'id'>,
  mission: Pick<Mission, 'ship'>,
): Vec3 {
  return {
    x: mission.ship.x,
    y: 0,
    z: mission.ship.z + shipLandingLocalZ(campaign),
  };
}
