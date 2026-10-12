import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import { createJapanAirbaseFrame, signedDistanceToJapanAirbaseVegetationFootprint } from '../content/airbaseLayout';
import type { BurnField } from './burnField';
import { classifyBurnSeverity, createVegetation, type VegetationContext } from './vegetation';

const mission: Mission = {
  id: 'TEST-01',
  title: 'Vegetation test',
  date: '2026-10-10',
  description: '',
  lesson: '',
  seed: 101,
  ship: { x: 0, z: 0, label: 'ship' },
  shipHeading: 0,
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
const japanCampaign = {
  id: 'jp_ketapang_2026_09',
  missions: [mission],
} as Campaign;

function context(
  visualTier: 'full' | 'reduced',
  burnField?: BurnField,
  roadsideRoads: VegetationContext['roadsideRoads'] = [],
): VegetationContext {
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
    farmExclusions: roadsideRoads?.length ? [{ center: { x: 1_900, z: -520 }, radius: 1_400 }] : [],
    roadsideRoads,
    roadsideExclusions: [],
    visualTier,
    burnField,
  };
}

function instanceMeshes(scene: THREE.Scene, prefix: string) {
  return scene.children.filter((object): object is THREE.InstancedMesh =>
    object instanceof THREE.InstancedMesh && object.name.startsWith(prefix));
}

function triangleCount(mesh: THREE.InstancedMesh) {
  return (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute('position').count) / 3;
}

function meanCanopyLuminance(scene: THREE.Scene) {
  let sum = 0;
  let count = 0;
  for (const mesh of instanceMeshes(scene, 'lowland tropical canopy')) {
    const colors = mesh.instanceColor?.array;
    if (!colors) continue;
    for (let index = 0; index < mesh.count; index++) {
      const offset = index * 3;
      sum += colors[offset] * .2126 + colors[offset + 1] * .7152 + colors[offset + 2] * .0722;
      count++;
    }
  }
  return sum / Math.max(1, count);
}

function distanceToRoad(point: { x: number; z: number }, road: { points: readonly { t: number; s: number }[] }) {
  let nearest = Infinity;
  for (let index = 1; index < road.points.length; index++) {
    const a = road.points[index - 1], b = road.points[index];
    const dt = b.t - a.t, ds = b.s - a.s;
    const lengthSquared = dt * dt + ds * ds;
    const fraction = lengthSquared ? THREE.MathUtils.clamp(
      ((point.x - a.t) * dt + (point.z - a.s) * ds) / lengthSquared, 0, 1,
    ) : 0;
    nearest = Math.min(nearest, Math.hypot(point.x - a.t - fraction * dt, point.z - a.s - fraction * ds));
  }
  return nearest;
}

function roadShoulderCounts(
  trees: readonly { x: number; z: number }[],
  road: { points: readonly { t: number; s: number }[] },
) {
  return road.points.slice(1).map((b, segmentIndex) => {
    const a = road.points[segmentIndex];
    const dt = b.t - a.t, ds = b.s - a.s;
    const length = Math.hypot(dt, ds);
    const counts = { positive: 0, negative: 0 };
    for (const tree of trees) {
      const fraction = THREE.MathUtils.clamp(((tree.x - a.t) * dt + (tree.z - a.s) * ds) / (length * length), 0, 1);
      if (fraction < .16 || fraction > .84) continue;
      const offsetT = tree.x - (a.t + dt * fraction);
      const offsetS = tree.z - (a.s + ds * fraction);
      const signedOffset = (dt * offsetS - ds * offsetT) / length;
      const magnitude = Math.abs(signedOffset);
      if (magnitude < 13 || magnitude > 24) continue;
      if (signedOffset > 0) counts.positive++;
      else counts.negative++;
    }
    return counts;
  });
}

describe('procedural tropical vegetation', () => {
  it('disposes every instance batch after removing it from the scene', () => {
    const scene = new THREE.Scene();
    const vegetation = createVegetation(scene, campaign, mission, context('full'));
    const instanceBatches: THREE.InstancedMesh[] = [];
    scene.traverse(object => {
      if (object instanceof THREE.InstancedMesh) instanceBatches.push(object);
    });
    const disposeSpies = instanceBatches.map(mesh => vi.spyOn(mesh, 'dispose'));

    vegetation.dispose();

    expect(instanceBatches.length).toBeGreaterThan(0);
    expect(disposeSpies.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    expect(instanceBatches.every(mesh => mesh.parent === null)).toBe(true);
  });

  it('classifies persistent burn severity at stable visual thresholds', () => {
    expect(classifyBurnSeverity(0)).toBe('unburned');
    expect(classifyBurnSeverity(.079)).toBe('unburned');
    expect(classifyBurnSeverity(.08)).toBe('fringe');
    expect(classifyBurnSeverity(.38)).toBe('scorched');
    expect(classifyBurnSeverity(.72)).toBe('charred');
    expect(classifyBurnSeverity(Number.NaN)).toBe('unburned');
  });

  it('keeps deterministic trunks, colliders, and flight clearances across visual tiers', () => {
    const fullScene = new THREE.Scene();
    const reducedScene = new THREE.Scene();
    const full = createVegetation(fullScene, campaign, mission, context('full'));
    const reducedMission = { ...mission, seed: mission.seed + 1 };
    const reduced = createVegetation(reducedScene, campaign, reducedMission, context('reduced'));
    const japanScene = new THREE.Scene();
    const japanMission = { ...mission, shore: { x: 2_000, z: -1_000, label: 'test shore pad' } };
    const japan = createVegetation(japanScene, japanCampaign, japanMission, context('full'));

    try {
      const fullTrunks = instanceMeshes(fullScene, 'lowland tree boles');
      const reducedTrunks = instanceMeshes(reducedScene, 'lowland tree boles');
      expect(full.treeColliders).toHaveLength(26_000);
      expect(reduced.treeColliders).toEqual(full.treeColliders);
      expect(japan.treeColliders).not.toEqual(full.treeColliders);
      expect(japan.stats.palms).toBeGreaterThan(full.stats.palms * 2);
      expect(japan.stats.secondary).toBeGreaterThan(full.stats.secondary);
      expect(meanCanopyLuminance(japanScene)).toBeGreaterThan(meanCanopyLuminance(fullScene));
      const airbaseFrame = createJapanAirbaseFrame(japanCampaign, japanMission);
      expect(japan.treeColliders.every(tree =>
        signedDistanceToJapanAirbaseVegetationFootprint(airbaseFrame, tree) > 0,
      )).toBe(true);
      const japanUnderstory = japanScene.getObjectByName('forest understory') as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const understoryClearsAirbase = Array.from({ length: japanUnderstory.count }, (_, index) => {
        japanUnderstory.getMatrixAt(index, matrix);
        matrix.decompose(position, quaternion, scale);
        return signedDistanceToJapanAirbaseVegetationFootprint(airbaseFrame, position) > 0;
      });
      expect(understoryClearsAirbase.every(Boolean)).toBe(true);
      expect(full.stats.woodyPlants).toBe(full.stats.visiblePlants);
      expect(reduced.stats.visiblePlants).toBe(reduced.treeColliders.length);
      expect(fullTrunks.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(26_000);
      expect(reducedTrunks.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(26_000);
      expect(fullTrunks.length).toBeLessThanOrEqual(12);

      const clearance = Math.min(...full.treeColliders.map(tree => {
        const routeX = Math.max(mission.ship.x, Math.min(mission.fire.x, tree.x));
        return Math.hypot(tree.x - routeX, tree.z) - tree.radius;
      }));
      expect(clearance).toBeGreaterThan(60);

      const fullUnderstory = fullScene.getObjectByName('forest understory') as THREE.InstancedMesh;
      const reducedUnderstory = reducedScene.getObjectByName('forest understory') as THREE.InstancedMesh;
      expect(reduced.stats.understory).toBe(full.stats.understory);
      expect(full.stats.understory).toBe(7_000);
      expect(reducedUnderstory.instanceMatrix.array).toEqual(fullUnderstory.instanceMatrix.array);
    } finally {
      full.dispose();
      reduced.dispose();
      japan.dispose();
    }
  });

  it('plants stable tree rows on both road shoulders and registers every trunk', () => {
    const road = {
      id: 'test-main-road',
      kind: 'paved' as const,
      points: [
        { t: 700, s: -600 },
        { t: 1_450, s: -600 },
        { t: 2_100, s: -300 },
        { t: 2_800, s: -600 },
        { t: 3_400, s: -600 },
      ],
    };
    const crossingRoad = {
      id: 'test-crossing-road',
      kind: 'gravel' as const,
      points: [{ t: 1_800, s: -1_250 }, { t: 1_800, s: 450 }],
    };
    const fullScene = new THREE.Scene();
    const reducedScene = new THREE.Scene();
    const roads = [road, crossingRoad];
    const full = createVegetation(fullScene, campaign, mission, context('full', undefined, roads));
    const reduced = createVegetation(reducedScene, campaign, mission, context('reduced', undefined, roads));

    try {
      for (const shoulders of [...roadShoulderCounts(full.treeColliders, road), ...roadShoulderCounts(full.treeColliders, crossingRoad)]) {
        expect(shoulders.positive).toBeGreaterThan(5);
        expect(shoulders.negative).toBeGreaterThan(5);
      }
      const crossingTrees = full.treeColliders.filter(tree =>
        Math.hypot(tree.x - 1_800, tree.z + 438) < 100,
      );
      expect(crossingTrees.every(tree =>
        distanceToRoad(tree, road) >= 15.4 && distanceToRoad(tree, crossingRoad) >= 15.4,
      )).toBe(true);
      expect(reduced.treeColliders).toEqual(full.treeColliders);
      expect(full.treeColliders).toHaveLength(26_000);
      expect(instanceMeshes(fullScene, 'lowland tree boles').reduce((sum, mesh) => sum + mesh.count, 0))
        .toBe(full.treeColliders.length);
      expect(instanceMeshes(reducedScene, 'lowland tree boles').reduce((sum, mesh) => sum + mesh.count, 0))
        .toBe(reduced.treeColliders.length);

      const minimumRouteClearance = Math.min(...full.treeColliders.map(tree => {
        const routeX = Math.max(mission.ship.x, Math.min(mission.fire.x, tree.x));
        return Math.hypot(tree.x - routeX, tree.z) - tree.radius;
      }));
      expect(minimumRouteClearance).toBeGreaterThan(60);
    } finally {
      full.dispose();
      reduced.dispose();
    }
  });

  it('switches spatial canopy batches across near, mid, and far LOD without hiding trunks', () => {
    const scene = new THREE.Scene();
    const vegetation = createVegetation(scene, campaign, mission, context('full'));
    const center = new THREE.Vector3(2_200, 0, 0);
    const canopies = instanceMeshes(scene, 'lowland tropical canopy');
    const trunks = instanceMeshes(scene, 'lowland tree boles');

    try {
      vegetation.update(center, 'high');
      expect(vegetation.stats.lodCells.near).toBeGreaterThan(0);
      expect(vegetation.stats.lodCells.mid).toBeGreaterThan(0);
      expect(vegetation.stats.lodCells.far).toBeGreaterThan(0);
      const detailedNearTriangles = Math.max(...canopies.map(triangleCount));
      expect(scene.getObjectByName('forest understory')?.visible).toBe(true);
      expect(trunks.every(mesh => mesh.visible)).toBe(true);
      expect(trunks.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(vegetation.treeColliders.length);

      vegetation.update(center, 'low');
      const mobileNearTriangles = Math.max(...canopies.map(triangleCount));
      expect(mobileNearTriangles).toBeLessThan(detailedNearTriangles);
      expect(scene.getObjectByName('forest understory')?.visible).toBe(false);
      expect(trunks.every(mesh => mesh.visible)).toBe(true);
      expect(trunks.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(vegetation.treeColliders.length);

      vegetation.update(new THREE.Vector3(100_000, 0, 100_000), 'high');
      expect(vegetation.stats.lodCells.far).toBe(canopies.length);
      expect(Math.max(...canopies.map(triangleCount))).toBeLessThan(mobileNearTriangles);
      expect(trunks.every(mesh => mesh.visible)).toBe(true);
      expect(trunks.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(26_000);
    } finally {
      vegetation.dispose();
    }
  });

  it('tints existing plants in burn zones without changing placement or losing scars across LOD tiers', () => {
    const burnField: BurnField = {
      bounds: { minX: 0, maxX: 5_000, minZ: -4_600, maxZ: 4_600 },
      size: 2,
      data: new Uint8Array(16),
      sample(x, z) {
        if (x > 2_500 && x < 2_800 && Math.abs(z) < 350) return { severity: .91, age: .18, activity: .82 };
        if (x > 1_250 && x < 1_600 && Math.abs(z) < 350) return { severity: .56, age: .52, activity: .24 };
        if (x > 500 && x < 800 && Math.abs(z) < 350) return { severity: .2, age: .8, activity: .05 };
        return { severity: 0, age: 0, activity: 0 };
      },
    };
    const cleanScene = new THREE.Scene();
    const fullScene = new THREE.Scene();
    const reducedScene = new THREE.Scene();
    const clean = createVegetation(cleanScene, campaign, mission, context('full'));
    const full = createVegetation(fullScene, campaign, mission, context('full', burnField));
    const reduced = createVegetation(reducedScene, campaign, mission, context('reduced', burnField));

    try {
      expect(full.treeColliders).toEqual(clean.treeColliders);
      expect(reduced.treeColliders).toEqual(clean.treeColliders);
      expect(full.stats.visiblePlants).toBe(clean.stats.visiblePlants);
      expect(reduced.stats.visiblePlants).toBe(clean.stats.visiblePlants);
      expect(full.stats.charredTrees).toBeGreaterThan(0);
      expect(full.stats.scorchedTrees).toBeGreaterThan(0);
      expect(full.stats.fringeTrees).toBeGreaterThan(0);
      expect(full.stats.burnedTrees).toBe(full.stats.fringeTrees + full.stats.scorchedTrees + full.stats.charredTrees);
      expect(reduced.stats.charredTrees).toBe(full.stats.charredTrees);
      expect(reduced.stats.scorchedTrees).toBe(full.stats.scorchedTrees);
      expect(reduced.stats.fringeTrees).toBe(full.stats.fringeTrees);

      const cleanCanopyCount = instanceMeshes(cleanScene, 'lowland tropical canopy')
        .reduce((sum, mesh) => sum + mesh.count, 0);
      const fullCanopies = instanceMeshes(fullScene, 'lowland tropical canopy');
      const reducedCanopies = instanceMeshes(reducedScene, 'lowland tropical canopy');
      const fullCanopyCount = fullCanopies.reduce((sum, mesh) => sum + mesh.count, 0);
      expect(fullCanopyCount).toBeLessThan(cleanCanopyCount);
      expect(reducedCanopies.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(fullCanopyCount);

      const fullBranches = fullScene.getObjectByName('charred dead branches') as THREE.InstancedMesh;
      const reducedBranches = reducedScene.getObjectByName('charred dead branches') as THREE.InstancedMesh;
      expect(fullBranches).toBeInstanceOf(THREE.InstancedMesh);
      expect(fullBranches.count).toBe(full.stats.charredTrees);
      expect(fullBranches.count * triangleCount(fullBranches)).toBeLessThanOrEqual(30_000);
      expect(full.stats.damageTriangles).toBe(fullBranches.count * triangleCount(fullBranches));
      fullBranches.geometry.computeBoundingBox();
      const branchBounds = fullBranches.geometry.boundingBox!;
      expect(branchBounds.max.x).toBeGreaterThan(.9);
      expect(branchBounds.min.x).toBeLessThan(-.8);
      expect(branchBounds.max.y).toBeGreaterThan(.5);
      expect(branchBounds.min.y).toBeLessThan(-.4);
      const firstBranchMatrix = new THREE.Matrix4();
      const firstBranchPosition = new THREE.Vector3();
      const firstBranchScale = new THREE.Vector3();
      fullBranches.getMatrixAt(0, firstBranchMatrix);
      firstBranchMatrix.decompose(firstBranchPosition, new THREE.Quaternion(), firstBranchScale);
      const originalCollider = clean.treeColliders.find(tree => Math.hypot(
        tree.x - firstBranchPosition.x, tree.z - firstBranchPosition.z,
      ) < .01)!;
      expect(Math.max(branchBounds.max.x * firstBranchScale.x, -branchBounds.min.x * firstBranchScale.x))
        .toBeGreaterThan(originalCollider.radius * .55);
      expect((branchBounds.max.y - branchBounds.min.y) * firstBranchScale.y)
        .toBeGreaterThan(originalCollider.radius * .5);
      expect(fullBranches.instanceMatrix.array).toEqual(reducedBranches.instanceMatrix.array);
      expect(fullBranches.visible).toBe(true);

      const cleanUnderstory = cleanScene.getObjectByName('forest understory') as THREE.InstancedMesh;
      const fullUnderstory = fullScene.getObjectByName('forest understory') as THREE.InstancedMesh;
      expect(fullUnderstory.instanceMatrix.array).toEqual(cleanUnderstory.instanceMatrix.array);
      expect(fullUnderstory.instanceColor?.array).not.toEqual(cleanUnderstory.instanceColor?.array);

      const countsBeforeLodChange = fullCanopies.map(mesh => mesh.count);
      full.update(new THREE.Vector3(2_500, 0, 300), 'high');
      expect(fullCanopies.map(mesh => mesh.count)).toEqual(countsBeforeLodChange);
      expect(fullBranches.visible).toBe(true);
      full.update(new THREE.Vector3(100_000, 0, 100_000), 'low');
      expect(fullCanopies.map(mesh => mesh.count)).toEqual(countsBeforeLodChange);
      expect(fullBranches.visible).toBe(true);
      expect(instanceMeshes(fullScene, 'lowland tree boles').reduce((sum, mesh) => sum + mesh.count, 0))
        .toBe(clean.treeColliders.length);
    } finally {
      clean.dispose();
      full.dispose();
      reduced.dispose();
    }
  });
});
