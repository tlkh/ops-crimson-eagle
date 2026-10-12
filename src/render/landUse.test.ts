import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { getCampaignGeography, getCampaignRoadTermini, sampleRoad } from '../content/geography';
import { getCampaignSites } from '../content/geographySites';
import { renderedTerrainHeight, terrainHeight } from '../sim/collision';
import { createCoastalSampler } from './coastalSampling';
import { createLandUse, type LandUseContext } from './landUse';

function contextFor(campaign: typeof campaigns[number], mission: typeof campaigns[number]['missions'][number]): LandUseContext {
  const sampler = createCoastalSampler(campaign, mission);
  const flightLegs = campaign.missions.flatMap(item => {
    const first = item.shore ?? item.lake;
    return [[item.ship, first], [first, item.lake], [item.lake, item.fire]] as const;
  });
  return {
    fromLocal: (t, s) => sampler.fromLocal(t, s),
    terrainHeight: (x, z) => terrainHeight(campaign, mission, x, z) ?? -9,
    renderedTerrainHeight: (x, z) => renderedTerrainHeight(campaign, mission, x, z),
    coastAt: sampler.coastAt,
    flightLegs,
    lake: mission.lake,
    river: {
      centerS: t => -850 + 120 * Math.sin(t * .0021) + 75 * Math.sin(t * .0053),
      halfWidth: campaign.id === 'jp_ketapang_2026_09' ? 68 : 48,
    },
    shore: mission.shore,
  };
}

describe('connected rural land use', () => {
  for (const campaign of campaigns) {
    const geography = getCampaignGeography(campaign);
    const referenceMission = campaign.missions[0];
    it(`renders connected, clear roads and aligned bridges for ${campaign.name}`, () => {
      const context = contextFor(campaign, referenceMission);
      const scene = new THREE.Scene();
      const first = createLandUse(scene, campaign, referenceMission, context);
      const secondScene = new THREE.Scene();
      const second = createLandUse(secondScene, campaign, referenceMission, context);
      const sampleMainRoad = geography.roads.find(road => road.id === 'main-paved')!;
      const samplePoint = sampleMainRoad.points[Math.floor(sampleMainRoad.points.length * .62)];
      const sampleWorld = context.fromLocal(samplePoint.t, samplePoint.s);
      expect(first.exclusionZones.some(zone => Math.hypot(sampleWorld.x - zone.x, sampleWorld.z - zone.z) < zone.radius + 8)).toBe(true);
      expect(first.burnExclusionZones.some(zone => Math.hypot(sampleWorld.x - zone.x, sampleWorld.z - zone.z) < zone.radius + 8)).toBe(false);
      first.applyBurnField({
        bounds: { minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 },
        size: 1,
        data: new Uint8Array(4),
        sample: () => ({ severity: 1, age: .1, activity: .5 }),
      });
      expect(first.stats.roadLengthM).toBeGreaterThan(2500);
      expect(first.stats.trackLengthM).toBeGreaterThan(500);
      expect(first.stats.buildingCount).toBeGreaterThanOrEqual(12);
      expect(first.stats.drivewayCount).toBe(first.stats.buildingCount);
      for (const settlement of geography.settlements) {
        expect(first.stats.destinationBuildingCounts[settlement.id], `${settlement.id} buildings`).toBeGreaterThan(0);
        expect(first.stats.destinationDrivewayCounts[settlement.id], `${settlement.id} driveways`).toBe(
          first.stats.destinationBuildingCounts[settlement.id],
        );
      }
      expect(first.stats.bridgeCount).toBeGreaterThan(0);
      expect(first.stats.palmCount).toBeGreaterThan(0);
      const unservedTermini = getCampaignRoadTermini(geography.roads).filter(terminus => {
        const road = geography.roads.find(item => item.id === terminus.roadId)!;
        return road.frontage !== 'none' && !terminus.roadId.startsWith('response-access-')
          && geography.settlements.every(settlement => Math.hypot(
          settlement.position.t - terminus.position.t,
          settlement.position.s - terminus.position.s,
          ) > 210)
          && !geography.destinations.some(destination => ['field', 'coastal', 'gate', 'response'].includes(destination.kind)
            && Math.hypot(destination.position.t - terminus.position.t, destination.position.s - terminus.position.s) < 110);
      });
      expect(first.stats.roadEndClusterCount).toBe(unservedTermini.length);
      for (const terminus of unservedTermini) {
        const prefix = `Road-end ${terminus.roadId} ${terminus.end}`;
        const buildings = first.structureColliders.filter(item => item.label.startsWith(prefix));
        const endpoint = context.fromLocal(terminus.position.t, terminus.position.s);
        expect(buildings, prefix).toHaveLength(2);
        for (const building of buildings) {
          expect(Math.hypot(building.x - endpoint.x, building.z - endpoint.z), prefix).toBeLessThanOrEqual(70);
        }
      }
      expect(first.treeColliders.length).toBeGreaterThan(20);
      expect(first.structureColliders.filter(item => item.label.startsWith('Roadside frontage cottage')).length).toBeLessThanOrEqual(24);
      expect(first.exclusionZones.length).toBeGreaterThan(100);
      // Settlements now clear individual property and driveway footprints. A
      // centroid-sized circle here would erase both roadside tree rows.
      for (const settlement of geography.settlements) {
        const anchor = context.fromLocal(settlement.position.t, settlement.position.s);
        expect(first.exclusionZones.some(zone => Math.hypot(anchor.x - zone.x, anchor.z - zone.z) < 4 && zone.radius > 35), settlement.id).toBe(false);
      }
      expect(first.structureColliders.every(item => item.top > item.bottom)).toBe(true);

      const legDistance = (x: number, z: number, [start, end]: readonly [
        { x: number; z: number }, { x: number; z: number },
      ]) => {
        const dx = end.x - start.x, dz = end.z - start.z;
        const lengthSq = dx * dx + dz * dz;
        const u = lengthSq ? Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSq)) : 0;
        return Math.hypot(x - start.x - u * dx, z - start.z - u * dz);
      };
      // Every solid addition leaves the full aircraft footprint clear along each route.
      for (const structure of first.structureColliders) {
        const footprintRadius = Math.hypot(structure.halfWidth, structure.halfLength);
        expect(Math.min(...context.flightLegs.map(leg => legDistance(structure.x, structure.z, leg))) - footprintRadius).toBeGreaterThan(40);
      }
      for (const tree of first.treeColliders) {
        expect(Math.min(...context.flightLegs.map(leg => legDistance(tree.x, tree.z, leg))) - tree.radius).toBeGreaterThan(100);
      }

      const sampler = createCoastalSampler(campaign, referenceMission);
      for (const structure of first.structureColliders.filter(item => !item.label.includes('drainage bridge'))) {
        const local = sampler.toLocal(structure.x, structure.z);
        const footprintRadius = Math.hypot(structure.halfWidth, structure.halfLength);
        for (const road of geography.roads) {
          const points = sampleRoad(road.points, 8);
          let nearest = Infinity;
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i], dt = b.t - a.t, ds = b.s - a.s;
            const lengthSq = dt * dt + ds * ds;
            const u = lengthSq ? Math.max(0, Math.min(1, ((local.x - a.t) * dt + (local.z - a.s) * ds) / lengthSq)) : 0;
            nearest = Math.min(nearest, Math.hypot(local.x - a.t - u * dt, local.z - a.s - u * ds));
          }
          const roadRadius = road.kind === 'paved' ? 5.4 : road.kind === 'gravel' ? 4.2 : 3.1;
          expect(nearest).toBeGreaterThan(roadRadius + footprintRadius + 1);
        }
      }
      expect(scene.getObjectByName('Building access tracks')).toBeDefined();

      const roadMeshes: THREE.Mesh[] = [];
      const bridgeGroups: THREE.Group[] = [];
      scene.traverse(object => {
        if (object instanceof THREE.Mesh && /road surface|road shoulder|Bridge deck and ramp/i.test(object.name)) roadMeshes.push(object);
        if (object instanceof THREE.Group && object.name.includes('drainage bridge')) bridgeGroups.push(object);
      });
      expect(roadMeshes.length).toBeGreaterThan(geography.roads.length);
      const junctionSurfaces: THREE.Mesh[] = [];
      const junctionShoulders: THREE.Mesh[] = [];
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        if (/^Junction .* road surface$/.test(object.name)) junctionSurfaces.push(object);
        if (/^Junction .* shoulder apron$/.test(object.name)) junctionShoulders.push(object);
      });
      const drawableJunctions = geography.junctions.filter(junction => junction.arms.length >= 2);
      expect(junctionSurfaces).toHaveLength(drawableJunctions.length);
      expect(junctionShoulders).toHaveLength(drawableJunctions.length);
      for (const junction of [...junctionSurfaces, ...junctionShoulders]) {
        expect(junction.geometry.getIndex()!.count).toBeGreaterThan(0);
        const normals = junction.geometry.getAttribute('normal');
        expect(Array.from({ length: normals.count }, (_, index) => normals.getY(index)).reduce((sum, y) => sum + y, 0) / normals.count).toBeGreaterThan(.5);
      }
      expect(bridgeGroups).toHaveLength(first.stats.bridgeCount);
      for (const mesh of roadMeshes) {
        const positions = mesh.geometry.getAttribute('position');
        expect(positions.count, mesh.name).toBeGreaterThan(4);
        for (let i = 0; i < positions.count; i++) {
          expect(positions.getY(i)).toBeGreaterThan(-2);
          if (!mesh.name.includes('Bridge deck and ramp')) {
            const local = sampler.toLocal(positions.getX(i), positions.getZ(i));
            const riverClearance = Math.abs(local.z - context.river.centerS(local.x));
            expect(riverClearance, `${mesh.name} river clearance at ${local.x.toFixed(1)},${local.z.toFixed(1)}`).toBeGreaterThan(context.river.halfWidth * 1.22);
          }
        }
        const normals = mesh.geometry.getAttribute('normal');
        const meanUp = Array.from({ length: normals.count }, (_, i) => normals.getY(i)).reduce((sum, y) => sum + y, 0) / normals.count;
        expect(meanUp).toBeGreaterThan(.5);
      }
      for (const bridgeGroup of bridgeGroups) {
        const deck = bridgeGroup.getObjectByName('Bridge deck and ramp') as THREE.Mesh | undefined;
        expect(deck).toBeDefined();
        const positions = deck!.geometry.getAttribute('position');
        const bridge = deck!.userData.roadBridge as { channelStartIndex: number; channelEndIndex: number; startGroundY: number; endGroundY: number; channelDeckY: number };
        expect(bridge.channelDeckY).toBeGreaterThan(.5);
        const firstRampY = (positions.getY(0) + positions.getY(1)) * .5;
        const lastRampY = (positions.getY(positions.count - 2) + positions.getY(positions.count - 1)) * .5;
        expect(firstRampY).toBeCloseTo(bridge.startGroundY, 2);
        expect(lastRampY).toBeCloseTo(bridge.endGroundY, 2);
        const startX = (positions.getX(0) + positions.getX(1)) * .5;
        const startZ = (positions.getZ(0) + positions.getZ(1)) * .5;
        const endX = (positions.getX(positions.count - 2) + positions.getX(positions.count - 1)) * .5;
        const endZ = (positions.getZ(positions.count - 2) + positions.getZ(positions.count - 1)) * .5;
        const startGround = context.renderedTerrainHeight(startX, startZ) ?? context.terrainHeight(startX, startZ);
        const endGround = context.renderedTerrainHeight(endX, endZ) ?? context.terrainHeight(endX, endZ);
        expect(firstRampY).toBeCloseTo(startGround + .22, 2);
        expect(lastRampY).toBeCloseTo(endGround + .22, 2);
        for (let row = bridge.channelStartIndex; row <= bridge.channelEndIndex; row++) {
          expect(positions.getY(row * 2)).toBeGreaterThan(.5);
          expect(positions.getY(row * 2 + 1)).toBeGreaterThan(.5);
        }
        expect(bridgeGroup.children.some(child => child.name === 'Bridge guard rail')).toBe(true);
      }

      // The buffered exclusions cover the full line continuously, including tracks.
      for (const road of geography.roads) for (const local of sampleRoad(road.points, 24)) {
        const world = context.fromLocal(local.t, local.s);
        expect(first.exclusionZones.some(zone => Math.hypot(world.x - zone.x, world.z - zone.z) < zone.radius)).toBe(true);
      }

      const fields = getCampaignSites(campaign).fields;
      expect(new Set(first.stats.fieldIds).size).toBe(first.stats.fieldCount);
      for (const field of fields) {
        expect(first.stats.fieldIds, `${field.id} rendered plot`).toContain(field.id);
        expect(geography.destinations.some(destination => destination.id === field.id && destination.kind === 'field'
          && Math.hypot(destination.position.t - field.entrance.t, destination.position.s - field.entrance.s) < 1), `${field.id} graph destination`).toBe(true);
        const entranceDistance = Math.min(...geography.roads.flatMap(road => {
          const points = sampleRoad(road.points, 8);
          return points.slice(1).map((point, index) => {
            const a = points[index], dt = point.t - a.t, ds = point.s - a.s;
            const lengthSq = dt * dt + ds * ds;
            const u = lengthSq ? Math.max(0, Math.min(1, ((field.entrance.t - a.t) * dt + (field.entrance.s - a.s) * ds) / lengthSq)) : 0;
            return Math.hypot(field.entrance.t - a.t - u * dt, field.entrance.s - a.s - u * ds);
          });
        }));
        expect(entranceDistance, `${field.id} road connection`).toBeLessThan(1);
      }
      expect(first.stats.fieldCount).toBeGreaterThanOrEqual(5);

      const watchedMesh = roadMeshes.find(mesh => mesh.name.includes('road surface'))!;
      const burnedRoadColors = watchedMesh.geometry.getAttribute('color');
      expect(burnedRoadColors).toBeDefined();
      expect(Array.from(burnedRoadColors.array).some(value => value < .1)).toBe(true);
      const disposeGeometry = vi.spyOn(watchedMesh.geometry, 'dispose');
      const watchedMaterial = watchedMesh.material as THREE.Material;
      const disposeMaterial = vi.spyOn(watchedMaterial, 'dispose');
      const palmInstances = [
        scene.getObjectByName('Farm palm trunks'),
        scene.getObjectByName('Farm palm crowns'),
      ].filter((object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh);
      const disposePalmInstances = palmInstances.map(mesh => vi.spyOn(mesh, 'dispose'));
      expect(palmInstances).toHaveLength(2);
      expect(second.stats).toEqual(first.stats);
      expect(second.structureColliders).toEqual(first.structureColliders);
      first.dispose();
      second.dispose();
      expect(scene.children).toHaveLength(0);
      expect(disposeGeometry).toHaveBeenCalledOnce();
      expect(disposeMaterial).toHaveBeenCalledOnce();
      expect(disposePalmInstances.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
      expect(palmInstances.every(mesh => scene.getObjectById(mesh.id) === undefined)).toBe(true);
    });

    it(`keeps road lengths and bridge placement deterministic across ${campaign.name} missions`, () => {
      const samples = campaign.missions.map(mission => {
        const scene = new THREE.Scene();
        const result = createLandUse(scene, campaign, mission, contextFor(campaign, mission));
        let hash = 2166136261;
        scene.traverse(object => {
          if (!(object instanceof THREE.Mesh) || !/road surface|road shoulder|Bridge deck and ramp/i.test(object.name)) return;
          for (let i = 0; i < object.name.length; i++) hash = Math.imul(hash ^ object.name.charCodeAt(i), 16777619);
          for (const value of object.geometry.getAttribute('position').array) hash = Math.imul(hash ^ Math.round(value * 1000), 16777619);
        });
        const metrics = {
          roadLengthM: result.stats.roadLengthM,
          trackLengthM: result.stats.trackLengthM,
          bridgeCount: result.stats.bridgeCount,
          structures: result.structureColliders,
          roadGeometryHash: hash >>> 0,
        };
        result.dispose();
        return metrics;
      });
      expect(samples.every(sample => JSON.stringify(sample) === JSON.stringify(samples[0]))).toBe(true);
    });
  }
});
