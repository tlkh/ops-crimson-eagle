import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import { createVegetation, type VegetationContext } from './vegetation';

const mission: Mission = {
  id: 'TEST-01',
  title: 'Vegetation test',
  date: '2026-10-10',
  description: '',
  lesson: '',
  seed: 101,
  ship: { x: 0, z: 0, label: 'ship' },
  lake: { x: 2_100, z: 0, radius: 115, label: 'lake' },
  fire: { x: 3_400, z: 0, radius: 105, label: 'fire' },
  wind: { x: 0, z: 0 },
  requiredDrops: 1,
  peat: false,
  protectedLabel: 'test',
  durationTargetSec: 300,
  timeOfDay: { startMinutes: 360, endMinutes: 480 },
};

const campaign = {
  id: 'sg_fictional_2026_10',
  missions: [mission],
} as Campaign;

function context(visualTier: 'full' | 'reduced'): VegetationContext {
  const fromLocal = (t: number, s: number) => ({ x: t, z: s });
  return {
    fromLocal,
    local: point => ({ t: point.x, s: point.z }),
    terrainHeight: () => 0,
    coastAt: () => 80,
    isLake: point => Math.hypot(point.x - mission.lake.x, point.z - mission.lake.z) < mission.lake.radius,
    riverS: () => -850,
    flightLegs: [[mission.ship, mission.lake], [mission.lake, mission.fire]],
    settlementExclusions: [],
    farmExclusions: [],
    visualTier,
  };
}

function triangleCount(mesh: THREE.InstancedMesh) {
  return (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute('position').count) / 3;
}

describe('procedural vegetation detail tiers', () => {
  it('keeps reduced-tier plants visible and collidable with campaign-stable placement', () => {
    const fullScene = new THREE.Scene();
    const reducedScene = new THREE.Scene();
    const full = createVegetation(fullScene, campaign, mission, context('full'));
    const reducedMission = { ...mission, seed: mission.seed + 1 };
    const reduced = createVegetation(reducedScene, campaign, reducedMission, context('reduced'));

    try {
      expect(full.treeColliders).toHaveLength(20_000);
      expect(reduced.treeColliders).toEqual(full.treeColliders);
      expect(reduced.stats.visiblePlants).toBe(reduced.stats.woodyPlants);
      expect(reduced.stats.woodyPlants).toBe(reduced.treeColliders.length);
      expect((reducedScene.getObjectByName('lowland tree boles') as THREE.InstancedMesh).count).toBe(20_000);
      const clearance = Math.min(...full.treeColliders.map(tree => {
        const routeX = Math.max(mission.ship.x, Math.min(mission.fire.x, tree.x));
        return Math.hypot(tree.x - routeX, tree.z) - tree.radius;
      }));
      expect(clearance).toBeGreaterThan(60);
      const fullUnderstory = fullScene.getObjectByName('forest understory') as THREE.InstancedMesh;
      const reducedUnderstory = reducedScene.getObjectByName('forest understory') as THREE.InstancedMesh;
      expect(reduced.stats.understory).toBe(full.stats.understory);
      expect(reducedUnderstory.instanceMatrix.array).toEqual(fullUnderstory.instanceMatrix.array);

      for (const species of ['broadleaf', 'emergent', 'secondary', 'swamp', 'coastal', 'palm']) {
        const fullCrown = fullScene.getObjectByName(`${species} canopy`) as THREE.InstancedMesh;
        const reducedCrown = reducedScene.getObjectByName(`${species} canopy`) as THREE.InstancedMesh;
        expect(triangleCount(reducedCrown)).toBeLessThan(triangleCount(fullCrown));
      }
    } finally {
      full.dispose();
      reduced.dispose();
    }
  });
});
