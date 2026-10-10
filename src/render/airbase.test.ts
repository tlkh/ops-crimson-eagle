import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { getCampaignGeography, sampleRoad } from '../content/geography';
import { terrainHeight } from '../sim/collision';
import { isWithinLakeOutline } from '../sim/lakeShape';
import { createCoastalSampler } from './coastalSampling';
import { createJapanAirbase } from './airbase';

const campaign = campaigns.find(item => item.id === 'jp_ketapang_2026_09')!;
const mission = campaign.missions[0];

function fixture() {
  const scene = new THREE.Scene();
  const frame = createCoastalSampler(campaign, mission);
  const toWorld = (point: { x: number; z: number }) => frame.fromLocal(frame.routeLength + point.z, -point.x);
  const base = createJapanAirbase(scene, campaign, mission, {
    toWorld,
    terrainHeight: (x, z) => terrainHeight(campaign, mission, x, z) ?? -9,
    renderedTerrainHeight: () => null,
  })!;
  return { scene, frame, toWorld, base };
}

describe('Japan airbase expansion', () => {
  it('joins both open checkpoint entrances to the existing campaign roads on dry land', () => {
    const { base, toWorld, frame } = fixture();
    const geography = getCampaignGeography(campaign);
    const entrances = base.roads.filter(road => road.id.includes('west-'));
    expect(entrances).toHaveLength(2);
    for (const road of entrances) {
      const end = road.points.at(-1)!;
      const segmentDistance = (a: { t: number; s: number }, b: { t: number; s: number }) => {
        const dt = b.t - a.t, ds = b.s - a.s;
        const u = Math.max(0, Math.min(1, ((end.t - a.t) * dt + (end.s - a.s) * ds) / (dt * dt + ds * ds)));
        return Math.hypot(end.t - a.t - u * dt, end.s - a.s - u * ds);
      };
      expect(Math.min(...geography.roads.flatMap(item => item.points.slice(1).map((point, i) => segmentDistance(item.points[i], point))))).toBeLessThan(.01);
      for (const point of sampleRoad(road.points, 3)) {
        const world = frame.fromLocal(point.t, point.s);
        expect(terrainHeight(campaign, mission, world.x, world.z)).not.toBeNull();
        expect(isWithinLakeOutline(campaign.id, mission.lake, world, 8)).toBe(false);
      }
      const gate = road.points[0];
      for (let x = -198; x <= -180; x += 2) {
        const world = toWorld({ x, z: gate.t - frame.routeLength });
        expect(base.structureColliders.filter(item =>
          Math.abs(item.x - world.x) < item.halfWidth + 2 && Math.abs(item.z - world.z) < item.halfLength + 2,
        )).toHaveLength(0);
      }
    }
    base.dispose();
  });

  it('keeps the runway, handling pad and shoreline clear of new obstacles', () => {
    const { base, toWorld, frame } = fixture();
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
    for (const road of getCampaignGeography(campaign).roads) for (const point of sampleRoad(road.points, 3)) {
      const world = frame.fromLocal(point.t, point.s);
      if (fences.some(item => Math.abs(item.x - world.x) < item.halfWidth + 2
        && Math.abs(item.z - world.z) < item.halfLength + 2)) blockedRoads.push(`${road.id}: ${(-point.s).toFixed(1)},${(point.t - frame.routeLength).toFixed(1)}`);
    }
    expect(blockedRoads).toEqual([]);
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
    const shoulder = scene.getObjectByName('japan-airbase-west-main-gate shoulder') as THREE.Mesh;
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
