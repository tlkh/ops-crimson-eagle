import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHullPatch, createShipHull } from './shipHull';

function makeHull(japanese: boolean) {
  const group = new THREE.Group();
  const hullPaint = new THREE.MeshStandardMaterial();
  const deck = new THREE.MeshStandardMaterial();
  const beam = japanese ? 25.8 : 21;
  const length = japanese ? 178 : 141;
  const stern = japanese ? 40 : 35;
  const surface = createShipHull(group, length, beam, stern, japanese, hullPaint, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial(), deck);
  return { group, hullPaint, deck, beam, length, stern, surface };
}

describe('ship hull surface details', () => {
  it.each([false, true])('keeps the %s campaign flight deck at tyre height and hull stations within its length', japanese => {
    const { group, deck, stern, length } = makeHull(japanese);
    const deckMeshes = group.children.filter(child => child instanceof THREE.Mesh && child.material === deck) as THREE.Mesh[];
    expect(deckMeshes).toHaveLength(1);
    const positions = deckMeshes[0].geometry.getAttribute('position');
    const aft = Array.from({ length: positions.count }, (_, i) => ({ y: positions.getY(i), z: positions.getZ(i) }))
      .filter(point => point.z > stern - length * .65);
    expect(aft.length).toBeGreaterThan(0);
    expect(aft.every(point => Math.abs(point.y + 2.525) < 1e-5)).toBe(true);
    expect(Math.max(...Array.from({ length: positions.count }, (_, i) => positions.getZ(i)))).toBeCloseTo(stern, 5);
    expect(Math.min(...Array.from({ length: positions.count }, (_, i) => positions.getZ(i)))).toBeCloseTo(stern - length, 5);
  });

  it.each([false, true])('projects %s side panels onto the actual tapered hull triangles', japanese => {
    const { surface, stern, length } = makeHull(japanese);
    const z = stern - length * .8;
    for (const side of [-1, 1] as const) {
      const patch = createHullPatch(surface, { side, zMin: z - 5, zMax: z + 5, yMin: -6.4, yMax: -4.2 }, new THREE.MeshStandardMaterial());
      expect(patch.castShadow).toBe(false);
      const positions = patch.geometry.getAttribute('position');
      expect(positions.count).toBeGreaterThan(0);
      const xValues: number[] = [];
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
        xValues.push(point.x);
        const nearest = Math.min(...surface.sides[side].map(vertices => {
          const triangle = new THREE.Triangle(...vertices.map(v => new THREE.Vector3(...v)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
          return triangle.closestPointToPoint(point, new THREE.Vector3()).distanceTo(point);
        }));
        expect(nearest).toBeLessThan(.0195);
        expect(nearest).toBeGreaterThan(.014);
      }
      // The model's side is flared and station-tapered, so an X-flat patch
      // would visibly float at one end of this ten-metre footprint.
      expect(Math.max(...xValues) - Math.min(...xValues)).toBeGreaterThan(.2);
    }
  });
});
