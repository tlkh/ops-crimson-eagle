import { describe, expect, it } from 'vitest';
import { campaigns } from './index';
import { getCampaignGeography, sampleRoad, type LocalPoint } from './geography';
import { getCampaignSites } from './geographySites';
import { campaignTerrainFrame } from './terrainFrame';
import { terrainHeight } from '../sim/collision';
import { isWithinLakeOutline } from '../sim/lakeShape';
import { findUnmodeledRoadCrossings } from './roadGraph';

const near = (a: LocalPoint, b: LocalPoint, tolerance = 1e-5) => Math.hypot(a.t - b.t, a.s - b.s) <= tolerance;
const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);

function localFrame(campaignId: string, point: { x: number; z: number }): LocalPoint {
  const campaign = campaigns.find(item => item.id === campaignId)!;
  const { origin, ux, uz, sx, sz } = campaignTerrainFrame(campaign, campaign.missions[0]);
  const rx = point.x - origin.x;
  const rz = point.z - origin.z;
  return { t: rx * ux + rz * uz, s: rx * sx + rz * sz };
}

function edgeAngle(a: LocalPoint, b: LocalPoint): number {
  return Math.acos(Math.max(-1, Math.min(1, a.t * b.t + a.s * b.s)));
}

describe('campaign geography', () => {
  it('samples paths without losing authored junction anchors', () => {
    const authored: LocalPoint[] = [{ t: 0, s: 0 }, { t: 12, s: 0 }, { t: 12, s: 9 }];
    const samples = sampleRoad(authored, 5);

    expect(samples).toContainEqual(authored[1]);
    expect(samples.at(-1)).toEqual(authored[2]);
    expect(samples.every(point => Number.isFinite(point.t) && Number.isFinite(point.s))).toBe(true);
    expect(Math.max(...samples.slice(1).map((point, index) => distance(point, samples[index])))).toBeLessThanOrEqual(5);
    expect(() => sampleRoad(authored, 0)).toThrow(RangeError);
  });

  const built = new Map<string, ReturnType<typeof getCampaignGeography>>();
  for (const campaign of campaigns) {
    it(`${campaign.name} has a connected, destination-aware road graph with safe geometry`, () => {
      const geography = getCampaignGeography(campaign);
      built.set(campaign.id, geography);
      expect(getCampaignGeography(campaign)).toEqual(geography);
      expect(geography.sectors).toHaveLength(6);
      expect(geography.settlements.map(item => item.id)).toEqual(['village', 'hamlet', 'farm-one', 'farm-two']);
      expect(geography.sectors.map(item => item.missionId)).toEqual(campaign.missions.map(item => item.id));

      const roadIds = geography.roads.map(road => road.id);
      expect(new Set(roadIds).size).toBe(roadIds.length);
      expect(roadIds).toContain('main-paved');
      expect(roadIds).toContain('sector-access-spine');
      for (const mission of campaign.missions) {
        expect(roadIds).toContain(`sector-access-${mission.id.toLowerCase()}`);
        expect(roadIds).toContain(`response-access-${mission.id.toLowerCase()}`);
      }
      expect(roadIds).not.toContain('coastal-feeder-loop');
      expect(roadIds).not.toContain('inland-feeder-loop');
      expect(roadIds).not.toContain('shore-support-perimeter');

      const roadById = new Map(geography.roads.map(road => [road.id, road]));
      const mainRoad = roadById.get('main-paved')!;
      expect(mainRoad.kind).toBe('paved');
      expect(mainRoad.frontage).toBe('settlement');
      expect(mainRoad.points.length).toBeGreaterThan(3);
      expect(distance(mainRoad.points[0], mainRoad.points.at(-1)!)).toBeGreaterThan(1000);
      expect(findUnmodeledRoadCrossings(geography.roads)).toEqual([]);

      const nodeById = new Map(geography.nodes.map(node => [node.id, node]));
      expect(nodeById.size).toBe(geography.nodes.length);
      expect(geography.edges.length).toBeGreaterThan(geography.roads.length);
      const edgeRoadIds = new Set(geography.edges.map(edge => edge.roadId));
      expect(edgeRoadIds).toEqual(new Set(roadIds));
      for (const edge of geography.edges) {
        const from = nodeById.get(edge.from)!, to = nodeById.get(edge.to)!;
        expect(edge.points.length).toBeGreaterThanOrEqual(2);
        expect(near(edge.points[0], from.position), edge.id).toBe(true);
        expect(near(edge.points.at(-1)!, to.position), edge.id).toBe(true);
        expect(edge.points.every(point => Number.isFinite(point.t) && Number.isFinite(point.s))).toBe(true);
      }

      const adjacency = new Map<string, string[]>();
      for (const edge of geography.edges) {
        adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
        adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
      }
      const mainEdge = geography.edges.find(edge => edge.roadId === 'main-paved')!;
      const reachable = new Set<string>([mainEdge.from]);
      const queue = [mainEdge.from];
      while (queue.length) {
        for (const next of adjacency.get(queue.shift()!) ?? []) if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
      expect(geography.edges.every(edge => reachable.has(edge.from) && reachable.has(edge.to))).toBe(true);
      expect(geography.destinations.length).toBeGreaterThan(geography.settlements.length + geography.sectors.length);
      for (const destination of geography.destinations) {
        const node = geography.nodes.find(candidate => near(candidate.position, destination.position));
        expect(node, destination.id).toBeDefined();
        expect((adjacency.get(node!.id) ?? []).length, destination.id).toBeGreaterThan(0);
        expect(reachable.has(node!.id), destination.id).toBe(true);
      }

      expect(geography.junctions.every(junction => junction.arms.length >= 3 && junction.arms.length <= 4)).toBe(true);
      for (const junction of geography.junctions) {
        for (const arm of junction.arms) expect(Math.hypot(arm.direction.t, arm.direction.s)).toBeCloseTo(1, 5);
        for (let first = 0; first < junction.arms.length; first++) for (let second = first + 1; second < junction.arms.length; second++) {
          const angle = edgeAngle(junction.arms[first].direction, junction.arms[second].direction);
          expect(angle, `${junction.id} at ${JSON.stringify(junction.position)} has an acute/near-parallel pair: ${JSON.stringify(junction.arms)}`).toBeGreaterThanOrEqual(Math.PI * 30 / 180);
        }
      }

      for (const sector of geography.sectors) {
        const mission = campaign.missions.find(item => item.id === sector.missionId)!;
        const fire = localFrame(campaign.id, mission.fire);
        const lake = localFrame(campaign.id, mission.lake);
        expect(distance(sector.position, fire)).toBeCloseTo(Math.max(340, mission.fire.radius + 260), 5);
        expect(geography.destinations.some(destination => destination.id === sector.id && near(destination.position, sector.position))).toBe(true);

        const access = roadById.get(`sector-access-${mission.id.toLowerCase()}`)!;
        const response = roadById.get(`response-access-${mission.id.toLowerCase()}`)!;
        expect(access.points.at(-1)).toEqual(sector.position);
        expect(response.points[0]).toEqual(sector.position);
        const accessArm = access.points.at(-2)!;
        const responseArm = response.points[1];
        const accessDirection = { t: accessArm.t - sector.position.t, s: accessArm.s - sector.position.s };
        const responseDirection = { t: responseArm.t - sector.position.t, s: responseArm.s - sector.position.s };
        const accessLength = Math.hypot(accessDirection.t, accessDirection.s);
        const responseLength = Math.hypot(responseDirection.t, responseDirection.s);
        expect(edgeAngle({ t: accessDirection.t / accessLength, s: accessDirection.s / accessLength },
          { t: responseDirection.t / responseLength, s: responseDirection.s / responseLength }), mission.id)
          .toBeGreaterThanOrEqual(Math.PI * 35 / 180);

        const radialT = fire.t - lake.t, radialS = fire.s - lake.s;
        const radialLength = Math.hypot(radialT, radialS);
        const endpoint = response.points.at(-1)!;
        const offsetT = endpoint.t - fire.t, offsetS = endpoint.s - fire.s;
        expect(Math.hypot(offsetT, offsetS)).toBeCloseTo(mission.fire.radius + 25, 5);
        expect(Math.abs(-offsetT * radialS / radialLength + offsetS * radialT / radialLength)).toBeCloseTo(55, 5);
        expect(offsetT * radialT / radialLength + offsetS * radialS / radialLength).toBeGreaterThan(0);
      }

      const sites = getCampaignSites(campaign);
      for (const field of sites.fields) {
        expect(roadById.has(`field-access-${field.id}`), field.id).toBe(true);
        expect(roadById.get(`field-access-${field.id}`)!.points.at(-1), field.id).toEqual(field.entrance);
      }
      if (sites.coastal) {
        expect(roadById.get('coastal-yard-access')!.points.at(-1)).toEqual(sites.coastal.entrance);
      }
      for (const gate of sites.airbaseGates) {
        expect(roadById.get(gate.id)?.points.at(-1), gate.id).toEqual(gate.position);
      }

      const referenceMission = campaign.missions[0];
      const lakeBoundaries = campaign.missions.map(mission => mission.lake);
      const { origin, ux, uz, sx, sz } = campaignTerrainFrame(campaign, referenceMission);
      const worldPoint = (point: LocalPoint) => ({
        x: origin.x + point.t * ux + point.s * sx,
        z: origin.z + point.t * uz + point.s * sz,
      });
      for (const road of geography.roads) for (const point of sampleRoad(road.points, 12)) {
        expect(Number.isFinite(point.t) && Number.isFinite(point.s), road.id).toBe(true);
        const world = worldPoint(point);
        for (const lake of lakeBoundaries) expect(isWithinLakeOutline(campaign.id, lake, world, 48), road.id).toBe(false);
        const ground = terrainHeight(campaign, referenceMission, world.x, world.z);
        expect(ground, `${road.id} has no terrain at (${point.t.toFixed(1)}, ${point.s.toFixed(1)})`).not.toBeNull();
        expect(ground!, `${road.id} is too close to the coast`).toBeGreaterThan(-2);
      }
    });
  }

  it('authors distinct main-route geometry for the agricultural and coastal-airbase campaigns', () => {
    const sg = built.get('sg_fictional_2026_10') ?? getCampaignGeography(campaigns[0]);
    const jp = built.get('jp_ketapang_2026_09') ?? getCampaignGeography(campaigns[1]);
    expect(sg.roads.find(road => road.id === 'main-paved')!.points).not.toEqual(jp.roads.find(road => road.id === 'main-paved')!.points);
    expect(sg.roads.some(road => road.id.startsWith('japan-airbase-'))).toBe(false);
    expect(jp.roads.filter(road => road.id.startsWith('japan-airbase-')).map(road => road.id)).toEqual([
      'japan-airbase-seaward-main-gate',
      'japan-airbase-seaward-service-gate',
      'japan-airbase-north-service-gate',
      'japan-airbase-north-connector',
    ]);
  });
});
