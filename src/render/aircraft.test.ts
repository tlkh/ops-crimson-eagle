import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { createAircraft } from './aircraft';

// Geometry needs texture containers, but these tests do not rasterize paint.
const context = new Proxy({}, {
  get: (_target, property) => property === 'createLinearGradient' || property === 'createRadialGradient'
    ? () => ({ addColorStop() {} }) : () => {},
});
const models: ReturnType<typeof createAircraft>[] = [];
beforeAll(() => {
  vi.stubGlobal('document', {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
      return { width: 1, height: 1, getContext: () => context };
    },
  });
  for (const campaign of campaigns) {
    const model = createAircraft(campaign);
    model.root.updateMatrixWorld(true);
    models.push(model);
  }
});
afterAll(() => {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const model of models) model.root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
  vi.unstubAllGlobals();
});

function meshesWithMaterial(root: THREE.Object3D, name: string) {
  const result: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && !Array.isArray(object.material) && object.material.name === name) result.push(object);
  });
  return result;
}

/** Recover physically separate tyre shells after material batching. */
function connectedBounds(mesh: THREE.Mesh<THREE.BufferGeometry>) {
  const positions = mesh.geometry.getAttribute('position');
  const parent = Array.from({ length: positions.count }, (_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  const duplicates = new Map<string, number>();
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(value => Math.round(value * 100_000)).join(',');
    const prior = duplicates.get(key);
    if (prior !== undefined) join(i, prior); else duplicates.set(key, i);
  }
  const indices = mesh.geometry.index;
  for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
    const a = indices?.getX(i) ?? i, b = indices?.getX(i + 1) ?? i + 1, c = indices?.getX(i + 2) ?? i + 2;
    join(a, b); join(b, c);
  }
  const bounds = new Map<number, THREE.Box3>();
  for (let i = 0; i < positions.count; i++) {
    const component = find(i), box = bounds.get(component) ?? new THREE.Box3();
    box.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    bounds.set(component, box);
  }
  return [...bounds.values()];
}

for (const [index, campaign] of campaigns.entries()) describe(`${campaign.id} aircraft geometry`, () => {
  it('has paired forward tyres and single aft tyres on the established contact plane', () => {
    const tyres = meshesWithMaterial(models[index].root, 'Chinook tyres').flatMap(connectedBounds);
    expect(tyres).toHaveLength(6);
    const centers = tyres.map(box => box.getCenter(new THREE.Vector3()));
    expect(centers.filter(center => center.z < 0)).toHaveLength(4);
    expect(centers.filter(center => center.z > 0)).toHaveLength(2);
    for (const box of tyres) {
      expect(box.min.y).toBeCloseTo(-2.52, 5);
      expect(box.max.y).toBeCloseTo(-1.64, 5);
    }
    for (const side of [-1, 1]) {
      const forward = centers.filter(center => center.z < 0 && Math.sign(center.x) === side);
      expect(forward.reduce((sum, center) => sum + center.x, 0) / forward.length).toBeCloseTo(side * 1.56, 5);
      expect(forward.every(center => Math.abs(center.z + 4.1) < .001)).toBe(true);
      const aft = centers.find(center => center.z > 0 && Math.sign(center.x) === side)!;
      expect(aft.x).toBeCloseTo(side * 1.56, 5);
      expect(aft.z).toBeCloseTo(5.8, 5);
    }
  });

  it('seats every light housing against the airframe rather than floating outside it', () => {
    const model = models[index];
    const solids = model.root.children.filter((object): object is THREE.Mesh =>
      object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh) &&
      !Array.isArray(object.material) && !object.material.transparent);
    for (const [name, mount] of Object.entries(model.lightMounts.mounts)) {
      const normal = mount.getWorldDirection(new THREE.Vector3());
      const origin = mount.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, .03);
      const ray = new THREE.Raycaster(origin, normal.negate(), 0, .26);
      expect(ray.intersectObjects(solids, false).length, `${name} housing has no airframe backing`).toBeGreaterThan(0);
    }
  });

  it('has a wide, shallow rear opening with a recessed, closed interior', () => {
    const model = models[index];
    const recess = meshesWithMaterial(model.root, 'Chinook rear cargo recess');
    expect(recess).toHaveLength(1);
    const bounds = new THREE.Box3().setFromObject(recess[0]);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    expect(size.x / size.y).toBeGreaterThan(2.6);
    expect(size.x / size.y).toBeLessThan(3.6);
    expect(size.z).toBeGreaterThan(.3);
    expect(size.z).toBeLessThan(1);
    // Rays through the central aperture must reach the recessed interior,
    // never an old painted cap or a hole all the way through the airframe.
    for (const x of [-.22, 0, .22]) for (const y of [-.15, 0, .15]) {
      const origin = new THREE.Vector3(center.x + size.x * x, center.y + size.y * y, bounds.max.z + .5);
      const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1), 0, 2)
        .intersectObject(model.root, true);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].object).toBe(recess[0]);
      expect(hits[0].point.z).toBeLessThan(bounds.max.z - .2);
      expect(hits[0].point.z).toBeGreaterThanOrEqual(bounds.min.z - .001);
    }
  });

  it('keeps painted skin behind the cockpit glass from each pane normal', () => {
    const model = models[index];
    const glass = meshesWithMaterial(model.root, 'Chinook cockpit glazing');
    expect(glass.length).toBeGreaterThan(0);
    const skin: THREE.Mesh[] = [];
    model.root.traverse(object => {
      if (object instanceof THREE.Mesh && !Array.isArray(object.material) && /painted skin|aft paint/.test(object.material.name)) skin.push(object);
    });
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const mesh of glass) {
      const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index;
      for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
        a.fromBufferAttribute(positions, indices?.getX(i) ?? i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(positions, indices?.getX(i + 1) ?? i + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(positions, indices?.getX(i + 2) ?? i + 2).applyMatrix4(mesh.matrixWorld);
        const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        if (normal.dot(center.clone().sub(new THREE.Vector3(0, 0, -5.2))) < 0) normal.negate();
        const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, .2), normal.negate(), 0, .197);
        expect(ray.intersectObjects(skin, false).length, `paint occludes glass near ${center.toArray()}`).toBe(0);
      }
    }
  });
});

it('centres the JGSDF roundels on the tanks with service lettering fully forward', () => {
  const model = models[campaigns.findIndex(campaign => campaign.id === 'jp_ketapang_2026_09')];
  const tankBounds = new THREE.Box3();
  for (const skin of meshesWithMaterial(model.root, 'JGSDF three-colour painted skin')) {
    const positions = skin.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(skin.matrixWorld);
      // Only the external fuel tanks carry painted skin this far outboard.
      if (Math.abs(point.x) > 1.6 && point.y < .15) tankBounds.expandByPoint(point);
    }
  }
  expect(tankBounds.isEmpty()).toBe(false);
  const tankCenterZ = tankBounds.getCenter(new THREE.Vector3()).z;
  const roundels = meshesWithMaterial(model.root, 'JGSDF roundel white').flatMap(connectedBounds);
  const lettering = meshesWithMaterial(model.root, 'JGSDF service lettering')
    .map(mesh => new THREE.Box3().setFromObject(mesh));
  expect(roundels).toHaveLength(2);
  expect(lettering).toHaveLength(2);
  for (const roundel of roundels) {
    const center = roundel.getCenter(new THREE.Vector3());
    expect(center.z).toBeCloseTo(tankCenterZ, 2);
    const text = lettering.find(bounds => Math.sign(bounds.getCenter(new THREE.Vector3()).x) === Math.sign(center.x))!;
    expect(text).toBeDefined();
    expect(text.max.z).toBeLessThan(roundel.min.z - .15);
    expect(text.min.z).toBeGreaterThan(tankBounds.min.z);
  }
});
