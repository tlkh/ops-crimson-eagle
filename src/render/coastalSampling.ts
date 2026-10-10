import type { Campaign, Mission } from '../types';
import { terrainHeight as collisionTerrainHeight } from '../sim/collision';
import { campaignTerrainFrame } from '../content/terrainFrame';

export const SEA_SURFACE_Y = -9;

export interface CoastalCoordinates {
  x: number;
  z: number;
}

export interface CoastalSample {
  t: number;
  s: number;
  /** Signed distance from the authored coast curve; positive values are inland. */
  shoreDistance: number;
  /** Height of the land field, or null while outside the terrain mesh. */
  terrainHeight: number | null;
  /** Exposed top surface: terrain above sea level, otherwise the sea plane. */
  surfaceHeight: number;
  isLand: boolean;
  /** Water within 72 m of the coast, including the submerged edge of the land field. */
  isShallow: boolean;
}

export interface CoastalSampleBuffer extends CoastalSample {}

export interface CoastalSampler {
  readonly routeLength: number;
  readonly coastStart: number;
  toLocal(x: number, z: number): CoastalCoordinates;
  toLocalInto(x: number, z: number, out: CoastalCoordinates): CoastalCoordinates;
  fromLocal(t: number, s: number): CoastalCoordinates;
  fromLocalInto(t: number, s: number, out: CoastalCoordinates): CoastalCoordinates;
  coastAt(s: number): number;
  sample(x: number, z: number): CoastalSample;
  /** Allocation-free variant for per-frame effects. */
  sampleInto(x: number, z: number, out: CoastalSampleBuffer): CoastalSampleBuffer;
}

/** Shared coastline frame and surface sampler for render effects. Its curve and height field
 * match the collision terrain; it does not introduce any new gameplay elevations. */
export function createCoastalSampler(campaign: Campaign, mission: Mission): CoastalSampler {
  const { origin, length: routeLength, ux, uz, sx, sz } = campaignTerrainFrame(campaign, mission);
  const coastStart = routeLength * .42;
  const coastAt = (s: number) => coastStart + 34 * Math.sin(s * .003) + 19 * Math.sin(s * .008 + .5);

  return {
    routeLength,
    coastStart,
    toLocal(x, z) { return this.toLocalInto(x, z, { x: 0, z: 0 }); },
    toLocalInto(x, z, out) {
      const rx = x - origin.x, rz = z - origin.z;
      out.x = rx * ux + rz * uz;
      out.z = rx * sx + rz * sz;
      return out;
    },
    fromLocal(t, s) { return this.fromLocalInto(t, s, { x: 0, z: 0 }); },
    fromLocalInto(t, s, out) {
      out.x = origin.x + t * ux + s * sx;
      out.z = origin.z + t * uz + s * sz;
      return out;
    },
    coastAt,
    sample(x, z) { return this.sampleInto(x, z, { t: 0, s: 0, shoreDistance: 0, terrainHeight: null, surfaceHeight: SEA_SURFACE_Y, isLand: false, isShallow: false }); },
    sampleInto(x, z, out) {
      const rx = x - origin.x, rz = z - origin.z;
      const t = rx * ux + rz * uz;
      const s = rx * sx + rz * sz;
      const shoreDistance = t - coastAt(s);
      const height = collisionTerrainHeight(campaign, mission, x, z);
      const isLand = height !== null && height > SEA_SURFACE_Y;
      out.t = t;
      out.s = s;
      out.shoreDistance = shoreDistance;
      out.terrainHeight = height;
      out.surfaceHeight = isLand ? height : SEA_SURFACE_Y;
      out.isLand = isLand;
      out.isShallow = !isLand && (shoreDistance > -72 && shoreDistance < 72);
      return out;
    },
  };
}
