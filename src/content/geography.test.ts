import { describe, expect, it } from 'vitest';
import { campaigns } from './index';
import { getCampaignGeography, sampleRoad, type LocalPoint } from './geography';
import { terrainHeight } from '../sim/collision';

const near = (a: LocalPoint, b: LocalPoint, tolerance = 1e-6) => Math.hypot(a.t - b.t, a.s - b.s) <= tolerance;
const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);

function pointToSegment(point: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dt = b.t - a.t;
  const ds = b.s - a.s;
  const lengthSquared = dt * dt + ds * ds;
  const fraction = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.t - a.t) * dt + (point.s - a.s) * ds) / lengthSquared));
  return Math.hypot(point.t - a.t - dt * fraction, point.s - a.s - ds * fraction);
}

function localFrame(campaignId: string, point: { x: number; z: number }): LocalPoint {
  const campaign = campaigns.find(item => item.id === campaignId)!;
  const mission = campaign.missions[0];
  const target = mission.shore ?? mission.lake;
  const dx = target.x - mission.ship.x;
  const dz = target.z - mission.ship.z;
  const length = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / length;
  const uz = dz / length;
  const rx = point.x - mission.ship.x;
  const rz = point.z - mission.ship.z;
  return { t: rx * ux + rz * uz, s: -rx * uz + rz * ux };
}

describe('campaign geography', () => {
  it('samples piecewise-linear paths and preserves every authored junction vertex', () => {
    const authored: LocalPoint[] = [{ t: 0, s: 0 }, { t: 12, s: 0 }, { t: 12, s: 9 }];
    const samples = sampleRoad(authored, 5);

    expect(samples).toContainEqual(authored[1]);
    expect(samples.at(-1)).toEqual(authored[2]);
    expect(samples.every(point => Number.isFinite(point.t) && Number.isFinite(point.s))).toBe(true);
    expect(Math.max(...samples.slice(1).map((point, index) => distance(point, samples[index])))).toBeLessThanOrEqual(5);
    expect(() => sampleRoad(authored, 0)).toThrow(RangeError);
  });

  for (const campaign of campaigns) {
    it(`${campaign.name} has stable, connected land roads for settlements and all six sectors`, () => {
      const geography = getCampaignGeography(campaign);
      const repeated = getCampaignGeography(campaign);
      expect(repeated).toEqual(geography);
      expect(geography.sectors).toHaveLength(6);
      expect(geography.settlements.map(item => item.id)).toEqual(['village', 'hamlet', 'farm-one', 'farm-two']);
      expect(geography.sectors.map(item => item.missionId)).toEqual(campaign.missions.map(item => item.id));

      const mainRoad = geography.roads.find(road => road.id === 'main-paved')!;
      const reachableRoadIds = new Set([mainRoad.id]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        const reachable = geography.roads.filter(road => reachableRoadIds.has(road.id));
        for (const road of geography.roads) {
          if (reachableRoadIds.has(road.id)) continue;
          const joinsNetwork = reachable.some(other => road.points.some(point => other.points.some(vertex => near(vertex, point))));
          if (joinsNetwork) {
            reachableRoadIds.add(road.id);
            expanded = true;
          }
        }
      }
      expect(reachableRoadIds.size).toBe(geography.roads.length);
      const allRoadPoints = geography.roads.flatMap(road => sampleRoad(road.points, 24));
      expect(Math.max(...allRoadPoints.map(point => point.t))).toBeGreaterThan(6200);
      for (const settlement of geography.settlements) {
        expect(geography.roads.some(road => reachableRoadIds.has(road.id) && road.points.some(point => near(point, settlement.position))), settlement.id).toBe(true);
      }
      for (const sector of geography.sectors) {
        const mission = campaign.missions.find(item => item.id === sector.missionId)!;
        expect(distance(sector.position, localFrame(campaign.id, mission.fire))).toBeCloseTo(100, 5);
        expect(geography.roads.some(road => reachableRoadIds.has(road.id) && road.points.some(point => near(point, sector.position))), sector.id).toBe(true);
        expect(geography.settlements.some(item => item.id === sector.settlementId)).toBe(true);
      }

      const referenceMission = campaign.missions[0];
      const lakeCenters = campaign.missions.map(mission => ({ center: localFrame(campaign.id, mission.lake), radius: mission.lake.radius }));
      const target = referenceMission.shore ?? referenceMission.lake;
      const dx = target.x - referenceMission.ship.x;
      const dz = target.z - referenceMission.ship.z;
      const length = Math.max(1, Math.hypot(dx, dz));
      const ux = dx / length;
      const uz = dz / length;
      const sx = -uz;
      const sz = ux;
      const worldPoint = (point: LocalPoint) => ({
        x: referenceMission.ship.x + point.t * ux + point.s * sx,
        z: referenceMission.ship.z + point.t * uz + point.s * sz,
      });
      for (const road of geography.roads) {
        for (let segment = 1; segment < road.points.length; segment++) {
          for (const lake of lakeCenters) {
            expect(pointToSegment(lake.center, road.points[segment - 1], road.points[segment])).toBeGreaterThanOrEqual(lake.radius + 49);
          }
        }
        for (const point of sampleRoad(road.points, 12)) {
          expect(Number.isFinite(point.t) && Number.isFinite(point.s), road.id).toBe(true);
          const ground = terrainHeight(campaign, referenceMission, ...Object.values(worldPoint(point)) as [number, number]);
          expect(ground, `${road.id} leaves authored land at (${point.t}, ${point.s})`).not.toBeNull();
          expect(ground!, `${road.id} runs too close to the coast`).toBeGreaterThan(-2);
        }
      }

      if (referenceMission.shore) {
        const perimeter = geography.roads.find(road => road.id === 'shore-support-perimeter')!;
        expect(perimeter).toBeDefined();
        const shore = localFrame(campaign.id, referenceMission.shore);
        for (const point of sampleRoad(perimeter.points, 12)) {
          expect(distance(point, shore)).toBeGreaterThan(900);
        }
      }

      const accessRoad = geography.roads.find(road => road.id === 'sector-access-spine')!;
      const lakeCenter = lakeCenters[0].center;
      const accessRadii = sampleRoad(accessRoad.points, 24).map(point => distance(point, lakeCenter));
      expect(Math.max(...accessRadii) - Math.min(...accessRadii)).toBeGreaterThan(100);
      expect(distance(accessRoad.points[0], accessRoad.points.at(-1)!)).toBeGreaterThan(500);
    });
  }
});
