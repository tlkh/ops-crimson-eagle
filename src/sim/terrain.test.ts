import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import type { Mission } from '../types';
import { renderedTerrainHeight, setRenderedTerrainHeights, TERRAIN_GRID, terrainHeight } from './collision';

function localPoint(mission: Mission, t: number, s: number) {
  const target = mission.shore ?? mission.lake;
  const dx = target.x - mission.ship.x, dz = target.z - mission.ship.z;
  const length = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / length, uz = dz / length, sx = -uz, sz = ux;
  return { x: mission.ship.x + t * ux + s * sx, z: mission.ship.z + t * uz + s * sz };
}

function coastAt(mission: Mission, s: number) {
  const target = mission.shore ?? mission.lake;
  const routeLength = Math.max(1, Math.hypot(target.x - mission.ship.x, target.z - mission.ship.z));
  const coast = routeLength * .42;
  return coast + 34 * Math.sin(s * .003) + 19 * Math.sin(s * .008 + .5);
}

describe('shared terrain field', () => {
  it('keeps the same hills when switching sorties within a campaign', () => {
    for (const campaign of campaigns) {
      const first = campaign.missions[0];
      for (let t = 1100; t <= 5800; t += 470) for (let s = -3800; s <= 3800; s += 760) {
        const point = localPoint(first, t, s);
        const base = terrainHeight(campaign, first, point.x, point.z);
        for (const mission of campaign.missions.slice(1)) {
          expect(terrainHeight(campaign, mission, point.x, point.z)).toBe(base);
        }
      }
    }
  });

  it('exports the terrain mesh dimensions and keeps mission routes and work areas low', () => {
    expect(TERRAIN_GRID).toEqual({ cols: 192, rows: 224, lateral: 4700, inland: 6500 });

    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const target = mission.shore ?? mission.lake;
      const routeLength = Math.hypot(target.x - mission.ship.x, target.z - mission.ship.z);
      const routePoint = localPoint(mission, routeLength * .72, 0);
      expect(terrainHeight(campaign, mission, routePoint.x, routePoint.z), `${campaign.id}/${mission.id} route`).not.toBeNull();
      expect(terrainHeight(campaign, mission, routePoint.x, routePoint.z)!).toBeLessThan(1);
      expect(terrainHeight(campaign, mission, mission.lake.x, mission.lake.z)!).toBeLessThan(1);
      expect(terrainHeight(campaign, mission, mission.fire.x, mission.fire.z)!).toBeLessThan(1);
      if (mission.shore) {
        expect(terrainHeight(campaign, mission, mission.shore.x, mission.shore.z)!).toBeLessThan(1);
      }
    }
  });

  it('keeps the shore transition and drainage ribbon below the water surface', () => {
    for (const campaign of campaigns) {
      const mission = campaign.missions[0];
      const target = mission.shore ?? mission.lake;
      const routeLength = Math.hypot(target.x - mission.ship.x, target.z - mission.ship.z);
      const coast = routeLength * .42;
      const s = 700;
      const shorePoint = localPoint(mission, coastAt(mission, s) - 2, s);
      const landPoint = localPoint(mission, coastAt(mission, s) + 1, s);
      expect(terrainHeight(campaign, mission, shorePoint.x, shorePoint.z)).toBeNull();
      expect(terrainHeight(campaign, mission, landPoint.x, landPoint.z)!).toBeLessThan(0);

      const t = coast + 2500;
      const riverS = -850 + 120 * Math.sin(t * .0021) + 75 * Math.sin(t * .0053);
      for (const offset of [-40, 0, 40]) {
        const point = localPoint(mission, t, riverS + offset);
        expect(terrainHeight(campaign, mission, point.x, point.z)!).toBeLessThan(1);
      }
    }
  });

  it('creates rolling inland elevations while keeping their upper bound at 60 m', () => {
    for (const campaign of campaigns) {
      const mission = campaign.missions[0];
      const target = mission.shore ?? mission.lake;
      const routeLength = Math.hypot(target.x - mission.ship.x, target.z - mission.ship.z);
      const coast = routeLength * .42;
      const heights: number[] = [];
      for (let t = Math.max(coast + 800, 1400); t <= 6200; t += 320) {
        for (let s = -4300; s <= 4300; s += 320) {
          const point = localPoint(mission, t, s);
          const height = terrainHeight(campaign, mission, point.x, point.z);
          if (height !== null) heights.push(height);
        }
      }
      expect(Math.max(...heights)).toBeGreaterThan(40);
      expect(Math.max(...heights)).toBeLessThanOrEqual(60);
      expect(heights.some(height => height >= 15 && height <= 45)).toBe(true);
    }
  });
});

describe('rendered terrain triangle interpolation', () => {
  it('matches the renderer barycentrics on both triangles in a quad', () => {
    const baseCampaign = campaigns[0];
    const mission: Mission = {
      ...baseCampaign.missions[0],
      ship: { ...baseCampaign.missions[0].ship },
      lake: { ...baseCampaign.missions[0].lake },
      fire: { ...baseCampaign.missions[0].fire },
    };
    const { cols, rows, lateral, inland } = TERRAIN_GRID;
    const sourceHeights = Array.from({ length: (rows + 1) * (cols + 1) }, (_, index) => index * .125 + (index % 11) * .7);
    const heights = Float32Array.from(sourceHeights);
    setRenderedTerrainHeights(mission, sourceHeights);

    const row = 80, col = 70;
    const s0 = -lateral + row / rows * lateral * 2;
    const s1 = -lateral + (row + 1) / rows * lateral * 2;
    const aT = coastAt(mission, s0) + col / cols * (inland - coastAt(mission, s0));
    const bT = coastAt(mission, s1) + col / cols * (inland - coastAt(mission, s1));
    const cT = coastAt(mission, s0) + (col + 1) / cols * (inland - coastAt(mission, s0));
    const dT = coastAt(mission, s1) + (col + 1) / cols * (inland - coastAt(mission, s1));
    const at = (indexRow: number, indexCol: number) => heights[indexRow * (cols + 1) + indexCol];

    // Renderer triangle A-B-C, with barycentric weights .20/.30/.50.
    const firstWeights = [.2, .3, .5];
    const firstT = firstWeights[0] * aT + firstWeights[1] * bT + firstWeights[2] * cT;
    const firstS = s0 + (s1 - s0) * firstWeights[1];
    const firstPoint = localPoint(mission, firstT, firstS);
    const firstExpected = firstWeights[0] * at(row, col) + firstWeights[1] * at(row + 1, col) + firstWeights[2] * at(row, col + 1);
    expect(renderedTerrainHeight(baseCampaign, mission, firstPoint.x, firstPoint.z)).toBeCloseTo(firstExpected, 5);

    // Renderer triangle B-D-C, with barycentric weights .25/.40/.35.
    const secondWeights = [.25, .4, .35];
    const secondT = secondWeights[0] * bT + secondWeights[1] * dT + secondWeights[2] * cT;
    const secondS = s0 + (s1 - s0) * (secondWeights[0] + secondWeights[1]);
    const secondPoint = localPoint(mission, secondT, secondS);
    const secondExpected = secondWeights[0] * at(row + 1, col) + secondWeights[1] * at(row + 1, col + 1) + secondWeights[2] * at(row, col + 1);
    expect(renderedTerrainHeight(baseCampaign, mission, secondPoint.x, secondPoint.z)).toBeCloseTo(secondExpected, 5);
  });
});
