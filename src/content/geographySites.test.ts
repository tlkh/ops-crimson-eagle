import { describe, expect, it } from 'vitest';
import { campaigns } from './index';
import type { LocalPoint } from './geography';
import { campaignTerrainFrame } from './terrainFrame';
import { getCampaignSites } from './geographySites';
import { isWithinLakeOutline } from '../sim/lakeShape';

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const pointDistance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);

function frameFor(campaign: (typeof campaigns)[number]) {
  const frame = campaignTerrainFrame(campaign, campaign.missions[0]);
  const fromLocal = (point: LocalPoint) => ({
    x: frame.origin.x + point.t * frame.ux + point.s * frame.sx,
    z: frame.origin.z + point.t * frame.uz + point.s * frame.sz,
  });
  return { frame, fromLocal };
}

function distanceToLeg(point: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const fraction = lengthSquared ? Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)) : 0;
  return Math.hypot(point.x - a.x - fraction * dx, point.z - a.z - fraction * dz);
}

describe('shared campaign asset sites', () => {
  it.each(campaigns)('$id exposes stable fields and coastal access clear of every sortie corridor', campaign => {
    const sites = getCampaignSites(campaign);
    expect(sites.fields).toHaveLength(7);
    expect(new Set(sites.fields.map(field => field.id)).size).toBe(sites.fields.length);
    expect(getCampaignSites(campaign)).toEqual(sites);

    const { fromLocal } = frameFor(campaign);
    const allLegs = campaign.missions.flatMap(mission => {
      const first = mission.shore ?? mission.lake;
      return [[mission.ship, first], [first, mission.lake], [mission.lake, mission.fire]] as const;
    });
    const coast = sites.coastal;
    expect(coast).toBeDefined();
    if (coast) {
      expect(pointDistance(coast.hut, coast.yard)).toBeGreaterThan(40);
      expect(pointDistance(coast.yard, coast.entrance)).toBeCloseTo(34, 5);
      for (const site of [coast.hut, coast.yard, coast.entrance]) {
        const world = fromLocal(site);
        expect(Math.min(...allLegs.map(([a, b]) => distanceToLeg(world, a, b)))).toBeGreaterThan(390);
        for (const mission of campaign.missions) {
          expect(isWithinLakeOutline(campaign.id, mission.lake, world, 150)).toBe(false);
          expect(distance(world, mission.fire)).toBeGreaterThan(mission.fire.radius + 150);
          expect(distance(world, mission.ship)).toBeGreaterThan(480);
          if (mission.shore) expect(distance(world, mission.shore)).toBeGreaterThan(1_050);
        }
      }
    }

    for (const field of sites.fields) {
      const along = field.angle;
      const dot = (field.entrance.t - field.center.t) * Math.cos(along)
        + (field.entrance.s - field.center.s) * Math.sin(along);
      expect(Math.abs(dot)).toBeCloseTo(field.length / 2 + 14, 5);
      expect(Math.abs((field.entrance.t - field.center.t) * -Math.sin(along)
        + (field.entrance.s - field.center.s) * Math.cos(along))).toBeCloseTo(0, 5);
    }
  });

  it('keeps Japan external gate anchors on the current rotated fence openings', () => {
    const japan = campaigns.find(campaign => campaign.id === 'jp_ketapang_2026_09')!;
    const sites = getCampaignSites(japan);
    const { frame, fromLocal } = frameFor(japan);
    expect(sites.airbaseGates.map(gate => gate.id)).toEqual([
      'japan-airbase-seaward-main-gate',
      'japan-airbase-seaward-service-gate',
      'japan-airbase-north-service-gate',
    ]);
    const shore = japan.missions[0].shore!;
    const heading = Math.atan2(frame.ux, frame.uz) - Math.PI / 2;
    const toWorld = (x: number, z: number) => ({
      x: shore.x + Math.cos(heading) * x + Math.sin(heading) * z,
      z: shore.z - Math.sin(heading) * x + Math.cos(heading) * z,
    });
    const localAnchors = [[-110, 378], [-110, 652], [373, 928.5]] as const;
    for (const [index, gate] of sites.airbaseGates.entries()) {
      const actual = fromLocal(gate.position);
      const [localX, localZ] = localAnchors[index]!;
      const expected = toWorld(localX, localZ);
      expect(actual.x).toBeCloseTo(expected.x, 10);
      expect(actual.z).toBeCloseTo(expected.z, 10);
    }
  });
});
