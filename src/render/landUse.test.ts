import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { renderedTerrainHeight, terrainHeight } from '../sim/collision';
import { createCoastalSampler } from './coastalSampling';
import { createLandUse, type LandUseContext } from './landUse';

describe('procedural rural land use', () => {
  for (const campaign of campaigns) {
    const mission = campaign.missions[0];
    it(`builds deterministic roads, farms, a bridge, and colliders for ${campaign.name}`, () => {
      const sampler = createCoastalSampler(campaign, mission);
      const flightLegs = campaign.missions.flatMap(item => {
        const first = item.shore ?? item.lake;
        return [[item.ship, first], [first, item.lake], [item.lake, item.fire]] as const;
      });
      const context: LandUseContext = {
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
      const first = createLandUse(new THREE.Scene(), campaign, mission, context);
      const second = createLandUse(new THREE.Scene(), campaign, mission, context);
      expect(first.stats.roadLengthM).toBeGreaterThan(2500);
      expect(first.stats.trackLengthM).toBeGreaterThan(500);
      expect(first.stats.fieldCount).toBeGreaterThanOrEqual(5);
      expect(first.stats.buildingCount).toBeGreaterThanOrEqual(12);
      expect(first.stats.bridgeCount).toBe(1);
      expect(first.treeColliders.length).toBeGreaterThan(20);
      expect(first.exclusionZones.length).toBeGreaterThan(30);
      expect(first.structureColliders.every(item => item.top > item.bottom)).toBe(true);
      const legDistance = (x: number, z: number, [start, end]: (typeof flightLegs)[number]) => {
        const dx = end.x - start.x, dz = end.z - start.z;
        const lengthSq = dx * dx + dz * dz;
        const u = lengthSq ? Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSq)) : 0;
        return Math.hypot(x - start.x - u * dx, z - start.z - u * dz);
      };
      // Solid additions must leave space for the full aircraft footprint along
      // every authored objective leg, including later missions in the theatre.
      for (const structure of first.structureColliders) {
        const footprintRadius = Math.hypot(structure.halfWidth, structure.halfLength);
        expect(Math.min(...flightLegs.map(leg => legDistance(structure.x, structure.z, leg))) - footprintRadius).toBeGreaterThan(40);
      }
      for (const tree of first.treeColliders) {
        expect(Math.min(...flightLegs.map(leg => legDistance(tree.x, tree.z, leg))) - tree.radius).toBeGreaterThan(100);
      }
      expect(second.stats).toEqual(first.stats);
      expect(second.structureColliders).toEqual(first.structureColliders);
      first.dispose();
      second.dispose();
    });
  }
});
