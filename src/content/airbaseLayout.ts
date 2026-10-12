import type { Campaign, Mission } from '../types';
import { CAMPAIGN_TERRAIN_AXIS_ANCHORS, CAMPAIGN_TERRAIN_ORIGIN, campaignTerrainFrame } from './terrainFrame';

export type AirbasePoint = { x: number; z: number };

/** Shared world transform for the Ketapang runway, support apron, and handling pad. */
export type JapanAirbaseFrame = {
  origin: AirbasePoint;
  /** Three.js y rotation; local +X points inland and local +Z points along +S. */
  heading: number;
  toWorld(point: AirbasePoint): AirbasePoint;
  toLocal(point: AirbasePoint): AirbasePoint;
};

function makeJapanAirbaseFrame(origin: AirbasePoint, heading: number): JapanAirbaseFrame {
  const c = Math.cos(heading), s = Math.sin(heading);
  const anchor = { x: origin.x, z: origin.z };
  return {
    origin: anchor,
    heading,
    toWorld(point) {
      return { x: anchor.x + c * point.x + s * point.z, z: anchor.z - s * point.x + c * point.z };
    },
    toLocal(point) {
      const dx = point.x - anchor.x, dz = point.z - anchor.z;
      return { x: c * dx - s * dz, z: s * dx + c * dz };
    },
  };
}

/** Keep the same fixed Japan orientation when only the pad is available. */
export function createJapanAirbaseFrameFromShore(shore: AirbasePoint): JapanAirbaseFrame {
  const axis = CAMPAIGN_TERRAIN_AXIS_ANCHORS.jp_ketapang_2026_09;
  const oldHeading = Math.atan2(axis.x - CAMPAIGN_TERRAIN_ORIGIN.x, axis.z - CAMPAIGN_TERRAIN_ORIGIN.z);
  return makeJapanAirbaseFrame(shore, oldHeading - Math.PI / 2);
}

/**
 * Rotate the airfield a quarter turn around the existing shore handling pad.
 * The authored apron's former +Z axis followed inland +T; after rotation that
 * direction is local +X, leaving the runway's local +Z axis parallel to shore.
 */
export function createJapanAirbaseFrame(campaign: Campaign, mission: Mission): JapanAirbaseFrame {
  if (!mission.shore) throw new Error('Japan airbase frame requires a shore handling pad');
  const { ux, uz } = campaignTerrainFrame(campaign, mission);
  const heading = Math.atan2(ux, uz) - Math.PI / 2;
  return makeJapanAirbaseFrame(mission.shore, heading);
}

type Polygon = readonly AirbasePoint[];

const surfaceRectangles = [
  // Shore handling pad and its clear apron.
  { minX: -48, maxX: 48, minZ: -34, maxZ: 34 },
  // Main apron, terminal, service apron, and the two runway connectors.
  { minX: -65, maxX: 220, minZ: 38, maxZ: 175 },
  { minX: 112, maxX: 260, minZ: -80, maxZ: -40 },
  { minX: 112, maxX: 260, minZ: 720, maxZ: 760 },
  // The runway is 30 m wide; this 40 m buffer keeps tree trunks and crowns clear.
  { minX: 195, maxX: 275, minZ: -120, maxZ: 880 },
] as const;

const vegetationRectangles = [
  { minX: -72, maxX: 235, minZ: -48, maxZ: 190 },
  { minX: 125, maxX: 345, minZ: -145, maxZ: 905 },
] as const;

const approachPolygons: readonly Polygon[] = [
  // 650 m clear approach extensions beyond both runway thresholds.
  [{ x: 125, z: -120 }, { x: 345, z: -120 }, { x: 475, z: -770 }, { x: -5, z: -770 }],
  [{ x: 125, z: 880 }, { x: 345, z: 880 }, { x: 475, z: 1530 }, { x: -5, z: 1530 }],
];

function rectangleDistance(point: AirbasePoint, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const dx = Math.abs(point.x - (rect.minX + rect.maxX) / 2) - (rect.maxX - rect.minX) / 2;
  const dz = Math.abs(point.z - (rect.minZ + rect.maxZ) / 2) - (rect.maxZ - rect.minZ) / 2;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}

function polygonDistance(point: AirbasePoint, polygon: Polygon): number {
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq)) : 0;
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t));
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside ? -nearest : nearest;
}

/** Signed metres to the nearest edge of the clear runway, taxi, apron, and approach footprint. */
export function signedDistanceToJapanAirbaseVegetationFootprint(frame: JapanAirbaseFrame, worldPoint: AirbasePoint): number {
  const point = frame.toLocal(worldPoint);
  return Math.min(
    ...vegetationRectangles.map(rect => rectangleDistance(point, rect)),
    ...approachPolygons.map(polygon => polygonDistance(point, polygon)),
  );
}

export function isWithinJapanAirbaseVegetationFootprint(frame: JapanAirbaseFrame, worldPoint: AirbasePoint): boolean {
  return signedDistanceToJapanAirbaseVegetationFootprint(frame, worldPoint) <= 0;
}

/** Burn history is suppressed over paved surfaces, while the wider approaches remain burnable. */
export function isWithinJapanAirbaseSurfaceFootprint(frame: JapanAirbaseFrame, worldPoint: AirbasePoint): boolean {
  const point = frame.toLocal(worldPoint);
  return surfaceRectangles.some(rect => rectangleDistance(point, rect) <= 0);
}
