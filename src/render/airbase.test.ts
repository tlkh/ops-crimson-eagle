import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { getCampaignGeography, sampleRoad } from '../content/geography';
import { terrainHeight } from '../sim/collision';
import { isWithinLakeOutline } from '../sim/lakeShape';
import { createCoastalSampler } from './coastalSampling';
import { createJapanAirbase } from './airbase';
import { createJapanAirbaseFrame, isWithinJapanAirbaseVegetationFootprint } from '../content/airbaseLayout';
import { getCampaignSites } from '../content/geographySites';

const campaign = campaigns.find(item => item.id === 'jp_ketapang_2026_09')!;
const mission = campaign.missions[0];

function fixture() {
  const scene = new THREE.Scene();
  const frame = createCoastalSampler(campaign, mission);
  const airbaseFrame = createJapanAirbaseFrame(campaign, mission);
  const toWorld = airbaseFrame.toWorld;
  const base = createJapanAirbase(scene, campaign, mission, {
    frame: airbaseFrame,
    terrainHeight: (x, z) => terrainHeight(campaign, mission, x, z) ?? -9,
    renderedTerrainHeight: () => null,
  })!;
  return { scene, frame, airbaseFrame, toWorld, base };
}

describe('Japan airbase expansion', () => {
  it('keeps shared gate roads in campaign geography and joins the internal apron at each opening', () => {
    const { base, toWorld, frame, airbaseFrame, scene } = fixture();
    const geography = getCampaignGeography(campaign);
    const gates = getCampaignSites(campaign).airbaseGates;
    expect(gates).toHaveLength(3);
    expect(base.stats.gateCount).toBe(3);
    expect(scene.getObjectByName('Airbase main gate checkpoint booth')).toBeDefined();
    expect(scene.getObjectByName('Airbase service gate checkpoint booth')).toBeDefined();
    expect(scene.getObjectByName('Airbase north service gate checkpoint booth')).toBeUndefined();
    expect(base.roads.some(road => road.id.includes('seaward-') && road.id.endsWith('-gate'))).toBe(false);
    const fenceColliders = base.structureColliders.filter(item => item.label === 'Airbase perimeter fence');
    for (const gate of gates) {
      const road = geography.roads.find(item => item.id === gate.id);
      expect(road, `${gate.id} must be authored by the campaign road graph`).toBeDefined();
      if (!road) continue;
      const endpointDistance = (point: { t: number; s: number }) => Math.hypot(point.t - gate.position.t, point.s - gate.position.s);
      const end = endpointDistance(road.points[0]) < endpointDistance(road.points.at(-1)!) ? road.points[0] : road.points.at(-1)!;
      expect(endpointDistance(end)).toBeLessThan(.01);
      const endWorld = frame.fromLocal(end.t, end.s);
      const endLocal = airbaseFrame.toLocal(endWorld);
      const anchor = gate.id.includes('main') ? { x: -110, z: 378 }
        : gate.id.includes('seaward') ? { x: -110, z: 652 }
          : { x: 373, z: 928.5 };
      expect(endLocal.x).toBeCloseTo(anchor.x, 5);
      expect(endLocal.z).toBeCloseTo(anchor.z, 5);

      const internalRoadId = gate.id.includes('main') ? 'japan-airbase-internal-access'
        : gate.id.includes('seaward') ? 'japan-airbase-service-access'
          : 'japan-airbase-north-checkpoint-drive';
      const internal = base.roads.find(item => item.id === internalRoadId)!;
      expect(Math.hypot(internal.points[0].t - gate.position.t, internal.points[0].s - gate.position.s)).toBeLessThan(.01);
      expect(Math.hypot(internal.points[0].t - end.t, internal.points[0].s - end.s)).toBeLessThan(.01);
      if (gate.id.includes('north')) {
        expect(Math.hypot(internal.points[1].t - internal.points[0].t, internal.points[1].s - internal.points[0].s)).toBeLessThan(40);
        const checkpoint = airbaseFrame.toLocal(frame.fromLocal(internal.points[1].t, internal.points[1].s));
        expect(checkpoint.x).toBeCloseTo(367, 5);
        expect(checkpoint.z).toBeCloseTo(898, 5);
      }
      for (const point of sampleRoad(road.points, 3)) {
        const world = frame.fromLocal(point.t, point.s);
        expect(terrainHeight(campaign, mission, world.x, world.z)).not.toBeNull();
        expect(isWithinLakeOutline(campaign.id, mission.lake, world, 8)).toBe(false);
        const local = airbaseFrame.toLocal(world);
        expect(isWithinJapanAirbaseVegetationFootprint(airbaseFrame, world),
          `${road.id} crosses the airport footprint at local ${local.x.toFixed(1)}, ${local.z.toFixed(1)}; join ends at ${endLocal.x.toFixed(1)}, ${endLocal.z.toFixed(1)}`).toBe(false);
        const fenceHits = fenceColliders.filter(item =>
          Math.abs(item.x - world.x) < item.halfWidth + 2 && Math.abs(item.z - world.z) < item.halfLength + 2,
        );
        const throughGate = gate.id.includes('north')
          ? local.x >= 355 && local.x <= 389
            && Math.abs(local.z - (930 + (local.x - 390) * (15 / 170))) < 4
          : Math.abs(local.x + 110) < 4 && Math.abs(local.z - anchor.z) < 14;
        expect(fenceHits.length === 0 || throughGate).toBe(true);
      }
      if (gate.id.includes('seaward')) {
        for (let x = -118; x <= -100; x += 2) {
          const world = toWorld({ x, z: endLocal.z });
          expect(base.structureColliders.filter(item =>
            Math.abs(item.x - world.x) < item.halfWidth + 2 && Math.abs(item.z - world.z) < item.halfLength + 2,
          )).toHaveLength(0);
        }
      }
    }
    base.dispose();
  });

  it('keeps the runway, handling pad and shoreline clear of new obstacles', () => {
    const { base, toWorld, frame, airbaseFrame } = fixture();
    const clear = (x: number, z: number, margin: number) => {
      const world = toWorld({ x, z });
      expect(base.structureColliders.filter(item =>
        Math.abs(item.x - world.x) < item.halfWidth + margin && Math.abs(item.z - world.z) < item.halfLength + margin,
      )).toEqual([]);
    };
    clear(0, 0, 30);
    for (let z = -110; z <= 870; z += 10) clear(235, z, 14);
    for (const fence of base.structureColliders.filter(item => item.label === 'Airbase perimeter fence')) {
      expect(isWithinLakeOutline(campaign.id, mission.lake, fence, 8)).toBe(false);
      expect(terrainHeight(campaign, mission, fence.x, fence.z)).not.toBeNull();
    }
    const fences = base.structureColliders.filter(item => item.label === 'Airbase perimeter fence');
    const blockedRoads: string[] = [];
    const roadsOverAirportFootprint: string[] = [];
    const gateOpenings = getCampaignSites(campaign).airbaseGates.map(gate => ({
      id: gate.id,
      local: airbaseFrame.toLocal(frame.fromLocal(gate.position.t, gate.position.s)),
    }));
    for (const road of getCampaignGeography(campaign).roads) for (const point of sampleRoad(road.points, 3)) {
      const world = frame.fromLocal(point.t, point.s);
      if (isWithinJapanAirbaseVegetationFootprint(airbaseFrame, world)) {
        roadsOverAirportFootprint.push(road.id);
      }
      const local = airbaseFrame.toLocal(world);
      const touchesFence = fences.some(item => Math.abs(item.x - world.x) < item.halfWidth + 2
        && Math.abs(item.z - world.z) < item.halfLength + 2);
      const throughGate = gateOpenings.some(gate => gate.id.includes('north')
        ? local.x >= 355 && local.x <= 389
          && Math.abs(local.z - (930 + (local.x - 390) * (15 / 170))) < 4
        : Math.abs(local.x - gate.local.x) < 4 && Math.abs(local.z - gate.local.z) < 14);
      if (touchesFence && !throughGate) blockedRoads.push(`${road.id}: ${local.x.toFixed(1)},${local.z.toFixed(1)}`);
    }
    expect(blockedRoads).toEqual([]);
    expect(roadsOverAirportFootprint).toEqual([]);
    base.dispose();
  });

  it('aligns rendered structures with collision bounds and disposes owned resources', () => {
    const { base, scene } = fixture();
    scene.updateMatrixWorld(true);
    let checked = 0;
    for (const collider of base.structureColliders) {
      const object = scene.getObjectByName(collider.label);
      if (!object) continue;
      const bounds = new THREE.Box3().setFromObject(object);
      expect(bounds.min.x).toBeGreaterThanOrEqual(collider.x - collider.halfWidth - .3);
      expect(bounds.max.x).toBeLessThanOrEqual(collider.x + collider.halfWidth + .3);
      expect(bounds.min.z).toBeGreaterThanOrEqual(collider.z - collider.halfLength - .3);
      expect(bounds.max.z).toBeLessThanOrEqual(collider.z + collider.halfLength + .3);
      expect(bounds.max.y).toBeLessThanOrEqual(collider.top + .3);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
    const dispose = vi.spyOn(THREE.InstancedMesh.prototype, 'dispose');
    base.dispose();
    expect(dispose).toHaveBeenCalled();
    expect(scene.children).toHaveLength(0);
    dispose.mockRestore();
  });

  it('samples road burn history at the rendered world position', () => {
    const { base, scene } = fixture();
    const shoulder = scene.getObjectByName('japan-airbase-internal-access shoulder') as THREE.Mesh;
    const vertex = new THREE.Vector3().fromBufferAttribute(shoulder.geometry.getAttribute('position'), 0);
    shoulder.localToWorld(vertex);
    const sample = vi.fn((_x: number, _z: number) => ({ severity: 1, age: .1, activity: .5 }));
    base.applyBurnField({ bounds: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 }, size: 1, data: new Uint8Array(4), sample });
    expect(sample.mock.calls[0][0]).toBeCloseTo(vertex.x, 4);
    expect(sample.mock.calls[0][1]).toBeCloseTo(vertex.z, 4);
    expect(shoulder.geometry.getAttribute('color')).toBeDefined();
    base.dispose();
  });
});
