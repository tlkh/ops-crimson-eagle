import { describe, expect, it } from 'vitest';
import { campaigns } from './index';
import { campaignTerrainFrame } from './terrainFrame';
import {
  createJapanAirbaseFrame,
  createJapanAirbaseFrameFromShore,
  isWithinJapanAirbaseSurfaceFootprint,
  isWithinJapanAirbaseVegetationFootprint,
  signedDistanceToJapanAirbaseVegetationFootprint,
} from './airbaseLayout';

const campaign = campaigns.find(item => item.id === 'jp_ketapang_2026_09')!;
const mission = campaign.missions[0];

describe('Japan airbase layout frame', () => {
  it('keeps the shore pad fixed and points local +X inland and +Z along +S', () => {
    const frame = createJapanAirbaseFrame(campaign, mission);
    const terrain = campaignTerrainFrame(campaign, mission);
    const oldHeading = Math.atan2(terrain.ux, terrain.uz);
    expect(frame.origin).toEqual({ x: mission.shore!.x, z: mission.shore!.z });
    expect(frame.heading).toBeCloseTo(oldHeading - Math.PI / 2, 10);

    const inland = frame.toWorld({ x: 1, z: 0 });
    const lateral = frame.toWorld({ x: 0, z: 1 });
    expect((inland.x - frame.origin.x) * terrain.ux + (inland.z - frame.origin.z) * terrain.uz).toBeCloseTo(1, 10);
    expect((lateral.x - frame.origin.x) * terrain.sx + (lateral.z - frame.origin.z) * terrain.sz).toBeCloseTo(1, 10);
    const local = { x: -190, z: 652 };
    expect(frame.toLocal(frame.toWorld(local)).x).toBeCloseTo(local.x, 10);
    expect(frame.toLocal(frame.toWorld(local)).z).toBeCloseTo(local.z, 10);
  });

  it('defines precise airport surface, runway, and tapered approach clearances', () => {
    const frame = createJapanAirbaseFrame(campaign, mission);
    const at = (x: number, z: number) => frame.toWorld({ x, z });
    expect(isWithinJapanAirbaseSurfaceFootprint(frame, at(0, 0))).toBe(true);
    expect(isWithinJapanAirbaseSurfaceFootprint(frame, at(235, 380))).toBe(true);
    expect(isWithinJapanAirbaseSurfaceFootprint(frame, at(235, -60))).toBe(true);
    expect(isWithinJapanAirbaseSurfaceFootprint(frame, at(800, 800))).toBe(false);

    expect(isWithinJapanAirbaseVegetationFootprint(frame, at(235, -400))).toBe(true);
    expect(isWithinJapanAirbaseVegetationFootprint(frame, at(445, -700))).toBe(true);
    expect(isWithinJapanAirbaseVegetationFootprint(frame, at(500, -700))).toBe(false);
    expect(signedDistanceToJapanAirbaseVegetationFootprint(frame, at(235, 380))).toBeLessThan(0);
    expect(signedDistanceToJapanAirbaseVegetationFootprint(frame, at(800, 800))).toBeGreaterThan(0);
  });

  it('keeps the burn footprint and world frame aligned if the pad anchor changes', () => {
    const moved = { ...mission, shore: { ...mission.shore!, x: 250, z: 450 } };
    const world = createJapanAirbaseFrame(campaign, moved);
    const burn = createJapanAirbaseFrameFromShore(moved.shore);
    const point = { x: 235, z: 380 };
    expect(burn.heading).toBeCloseTo(world.heading, 12);
    expect(burn.toWorld(point)).toEqual(world.toWorld(point));
  });
});
