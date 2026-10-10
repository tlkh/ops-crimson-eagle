import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { createCoastalDetails } from './coastalDetails';
import { createCoastalSampler } from './coastalSampling';
import { createDistantScenery } from './distantScenery';

type Point = { x: number; z: number };
type MissionCase = { campaign: (typeof campaigns)[number]; mission: (typeof campaigns)[number]['missions'][number] };

const missionCases: MissionCase[] = campaigns.flatMap(campaign =>
  campaign.missions.map(mission => ({ campaign, mission })),
);

function flightLegs(campaign: MissionCase['campaign']) {
  return campaign.missions.flatMap(mission => {
    const first = mission.shore ?? mission.lake;
    return [[mission.ship, first], [first, mission.lake], [mission.lake, mission.fire]] as [Point, Point][];
  });
}

function clearance(point: Point, legs: [Point, Point][]) {
  return Math.min(...legs.map(([a, b]) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq)) : 0;
    return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
  }));
}

function snapshot(details: ReturnType<typeof createCoastalDetails>) {
  return {
    stats: details.stats,
    treeColliders: details.treeColliders,
    structureColliders: details.structureColliders,
    boatInstances: details.boats.children.map(child => {
      const mesh = child as THREE.InstancedMesh;
      return { count: mesh.count, matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)) };
    }),
  };
}

function generate(campaign: MissionCase['campaign'], mission: MissionCase['mission']) {
  const scene = new THREE.Scene();
  const sampler = createCoastalSampler(campaign, mission);
  const details = createCoastalDetails(scene, campaign, mission, sampler, flightLegs(campaign));
  return { scene, details };
}

describe('coastal detail generation', () => {
  it.each(missionCases)('$campaign.id / $mission.id stays deterministic within its budgets and clear of flight routes', ({ campaign, mission }) => {
    const first = generate(campaign, mission);
    const instanceMeshes: THREE.InstancedMesh[] = [];
    first.scene.traverse(object => {
      if (object instanceof THREE.InstancedMesh) instanceMeshes.push(object);
    });
    const disposeSpies = instanceMeshes.map(mesh => vi.spyOn(mesh, 'dispose'));
    try {
      const { stats, treeColliders, structureColliders } = first.details;
      expect(stats.coastalDrawCalls).toBeLessThanOrEqual(12);
      expect(stats.coastalTriangles).toBeLessThanOrEqual(100_000);
      // Existing campaign layouts leave room for the planned small working fleet.
      expect(stats.boatCount).toBeGreaterThanOrEqual(6);
      expect(stats.boatCount).toBeLessThanOrEqual(8);
      expect(treeColliders.length).toBe(stats.mangroveCount);
      expect(treeColliders.length).toBeGreaterThan(0);
      expect(stats.mangrovePocketCount).toBeGreaterThan(0);

      const groupedTrees = treeColliders.filter(tree => treeColliders.some(other =>
        other !== tree && Math.hypot(other.x - tree.x, other.z - tree.z) < 90,
      ));
      expect(groupedTrees.length / treeColliders.length).toBeGreaterThan(.7);

      const legs = flightLegs(campaign);
      // Mangrove collider circles retain a 180 m gap from every authored flight leg.
      for (const tree of treeColliders) {
        expect(clearance(tree, legs) - tree.radius).toBeGreaterThanOrEqual(180);
      }

      // Sea boats have a route buffer; the three freshwater skiffs intentionally sit beside the lake.
      const coastalBoats = structureColliders.filter(collider =>
        collider.label === 'coastal working boat' &&
        Math.hypot(collider.x - mission.lake.x, collider.z - mission.lake.z) > mission.lake.radius + 300,
      );
      for (const boat of coastalBoats) {
        const conservativeRadius = Math.hypot(boat.halfWidth, boat.halfLength);
        expect(clearance(boat, legs) - conservativeRadius).toBeGreaterThanOrEqual(250);
      }

      const hut = structureColliders.find(collider => collider.label === 'coastal stilt hut and jetty');
      if (hut) expect(clearance(hut, legs)).toBeGreaterThan(300);
      const yardStructures = structureColliders.filter(collider => collider.label === 'coastal boat store shed' || collider.label === 'coastal fishing-yard fence');
      expect(yardStructures.length).toBe(stats.coastalYardCount);
      if (yardStructures.length) expect(stats.footpathSegments).toBeGreaterThan(2);
      for (const structure of yardStructures) {
        const conservativeRadius = Math.hypot(structure.halfWidth, structure.halfLength);
        expect(clearance(structure, legs) - conservativeRadius).toBeGreaterThanOrEqual(300);
      }

      const firstSnapshot = snapshot(first.details);
      const second = generate(campaign, mission);
      try {
        expect(snapshot(second.details)).toEqual(firstSnapshot);
      } finally {
        second.details.dispose();
      }
    } finally {
      first.details.dispose();
    }
    expect(instanceMeshes.length).toBeGreaterThan(0);
    expect(disposeSpies.every(dispose => dispose.mock.calls.length === 1)).toBe(true);
    expect(instanceMeshes.every(mesh => first.scene.getObjectById(mesh.id) === undefined)).toBe(true);
  });

  it.each(missionCases)('$campaign.id / $mission.id adds fog-compatible world-anchored distant scenery and skips previews', ({ campaign, mission }) => {
    const scene = new THREE.Scene();
    const preview = createDistantScenery(scene, campaign, mission, { preview: true });
    expect(scene.children).toHaveLength(0);
    preview.dispose();

    const scenery = createDistantScenery(scene, campaign, mission);
    const root = scene.children.find(child => child.name === 'Distant scenery') as THREE.Group | undefined;
    expect(root).toBeDefined();
    expect(root?.position.x).toBe(mission.ship.x);
    expect(root?.position.z).toBe(mission.ship.z);
    const japanese = campaign.id === 'jp_ketapang_2026_09';
    expect(root?.children.map(child => child.name)).toEqual(japanese
      ? ['Low inland ridge', 'Hazed inland ridge', 'Ketapang port horizon']
      : ['Low inland ridge', 'Hazed inland ridge']);
    root?.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      expect(materials.every(material => (material as THREE.MeshStandardMaterial).fog)).toBe(true);
      expect(mesh.castShadow).toBe(false);
    });
    scenery.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
