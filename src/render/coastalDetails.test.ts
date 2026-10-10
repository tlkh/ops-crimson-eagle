import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { createCoastalDetails } from './coastalDetails';
import { createCoastalSampler } from './coastalSampling';

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
    try {
      const { stats, treeColliders, structureColliders } = first.details;
      expect(stats.coastalDrawCalls).toBeLessThanOrEqual(12);
      expect(stats.coastalTriangles).toBeLessThanOrEqual(100_000);
      // Existing campaign layouts leave room for the planned small working fleet.
      expect(stats.boatCount).toBeGreaterThanOrEqual(6);
      expect(stats.boatCount).toBeLessThanOrEqual(8);
      expect(treeColliders.length).toBe(stats.mangroveCount);
      expect(treeColliders.length).toBeGreaterThan(0);

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
  });
});
