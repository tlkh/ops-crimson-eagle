import type { Campaign, Mission, Vec3 } from '../types';

type ShipPose = Pick<Mission, 'ship' | 'shipHeading'>;
type HorizontalPoint = { x: number; z: number };

/** Rotate a deck-local coordinate into the ship's authored world pose. */
export function shipToWorld(mission: ShipPose, local: HorizontalPoint): HorizontalPoint {
  const cosine = Math.cos(mission.shipHeading), sine = Math.sin(mission.shipHeading);
  return { x: mission.ship.x + local.x * cosine + local.z * sine,
    z: mission.ship.z - local.x * sine + local.z * cosine };
}

/** Express a world coordinate in the ship's deck frame. */
export function shipToLocal(mission: ShipPose, world: HorizontalPoint): HorizontalPoint {
  const dx = world.x - mission.ship.x, dz = world.z - mission.ship.z;
  const cosine = Math.cos(mission.shipHeading), sine = Math.sin(mission.shipHeading);
  return { x: dx * cosine - dz * sine, z: dx * sine + dz * cosine };
}

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
  mission: ShipPose,
): Vec3 {
  const point = shipToWorld(mission, { x: 0, z: shipLandingLocalZ(campaign) });
  return {
    x: point.x,
    y: 0,
    z: point.z,
  };
}
