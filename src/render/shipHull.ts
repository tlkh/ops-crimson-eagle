import * as THREE from 'three';

// The flight deck is 2.525 m below the aircraft origin after the .025 m
// surface lift. Keep the hull and all side fittings on this one station mesh.
const DECK = -2.55;
type Point = [number, number, number];
type Side = -1 | 1;
type SideTriangle = [Point, Point, Point];

export interface ShipHullSurface {
  sides: Record<Side, SideTriangle[]>;
}

export function createShipHull(
  group: THREE.Group, length: number, beam: number, stern: number, japanese: boolean,
  hullPaint: THREE.Material, boot: THREE.Material, below: THREE.Material, deck: THREE.Material,
): ShipHullSurface {
  const stations = japanese
    ? [[0, .11], [.035, .54], [.10, .84], [.19, .98], [.30, 1], [.91, 1], [1, .98]]
    : [[0, .10], [.045, .55], [.12, .87], [.22, .98], [.34, 1], [.91, 1], [1, .96]];
  const levels = [DECK, DECK - .75, -8.8, -9.22, -9.46, -13.2];
  const factors = [1, .99, .85, .83, .82, .70];
  const sides: Record<Side, SideTriangle[]> = { [-1]: [], [1]: [] };
  const surfaces = new Map<THREE.Material, { positions: number[]; uvs: number[] }>();
  const add = (material: THREE.Material, a: Point, b: Point, c: Point, ua: [number, number], ub: [number, number], uc: [number, number]) => {
    const out = surfaces.get(material) ?? { positions: [], uvs: [] };
    surfaces.set(material, out);
    out.positions.push(...a, ...b, ...c);
    out.uvs.push(...ua, ...ub, ...uc);
  };
  const quad = (material: THREE.Material, a: Point, b: Point, c: Point, d: Point, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number], side?: Side) => {
    add(material, a, b, c, ua, ub, uc);
    add(material, b, d, c, ub, ud, uc);
    if (side && material === hullPaint) {
      sides[side].push([a, b, c], [b, d, c]);
    }
  };
  const point = (i: number, j: number, side: Side): Point => {
    const [fraction, width] = stations[i];
    const z = stern - length + fraction * length;
    const rake = (1 - fraction) * Math.max(0, 1 - fraction / .19) * [0, .35, 5.8, 6.1, 6.3, 8][j];
    const sheer = j < 2 ? (japanese ? (fraction < .035 ? -1.65 : 0) : Math.max(0, 1 - fraction / .29) * 3.2) : 0;
    return [side * width * beam * .5 * factors[j], levels[j] + sheer, z + rake];
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const u0 = stations[i][0], u1 = stations[i + 1][0];
    for (const side of [-1, 1] as const) for (let j = 0; j < levels.length - 1; j++) {
      const material = j < 3 ? hullPaint : j === 3 ? boot : below;
      const a = point(i, j, side), b = point(i + 1, j, side), c = point(i, j + 1, side), d = point(i + 1, j + 1, side);
      const v0 = j / (levels.length - 1), v1 = (j + 1) / (levels.length - 1);
      if (side > 0) quad(material, a, b, c, d, [u0, v0], [u1, v0], [u0, v1], [u1, v1], side);
      else quad(material, b, a, d, c, [u1, v0], [u0, v0], [u1, v1], [u0, v1], side);
    }
    const a = point(i, 0, 1), b = point(i, 0, -1), c = point(i + 1, 0, 1), d = point(i + 1, 0, -1);
    const lift = (p: Point): Point => [p[0], p[1] + .025, p[2]];
    quad(deck, lift(a), lift(b), lift(c), lift(d), [(a[0] / beam) + .5, u0], [(b[0] / beam) + .5, u0], [(c[0] / beam) + .5, u1], [(d[0] / beam) + .5, u1]);
  }
  for (const i of [0, stations.length - 1]) for (let j = 0; j < levels.length - 1; j++) {
    const material = j < 3 ? hullPaint : j === 3 ? boot : below;
    const a = point(i, j, -1), b = point(i, j, 1), c = point(i, j + 1, -1), d = point(i, j + 1, 1);
    if (i === 0) quad(material, a, b, c, d, [0, j / 5], [1, j / 5], [0, (j + 1) / 5], [1, (j + 1) / 5]);
    else quad(material, b, a, d, c, [1, j / 5], [0, j / 5], [1, (j + 1) / 5], [0, (j + 1) / 5]);
  }
  for (let i = 0; i < stations.length - 1; i++) {
    quad(below, point(i + 1, 5, -1), point(i, 5, -1), point(i + 1, 5, 1), point(i, 5, 1), [1, 0], [0, 0], [1, 1], [0, 1]);
  }
  for (const [material, { positions, uvs }] of surfaces) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, material));
  }
  return { sides };
}

interface PatchBounds { side: Side; zMin: number; zMax: number; yMin: number; yMax: number; }

// Clip the y-z footprint against the same planar hull triangles that are
// rendered. Every resulting vertex is on the shell, including at station and
// level breaks; the tiny outward offset only prevents z-fighting.
export function createHullPatch(surface: ShipHullSurface, bounds: PatchBounds, material: THREE.Material, offset = .018): THREE.Mesh {
  const { side, zMin, zMax, yMin, yMax } = bounds;
  const positions: number[] = [], uvs: number[] = [];
  const clip = (polygon: Point[], axis: 1 | 2, threshold: number, keepAbove: boolean): Point[] => {
    const output: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const insideA = keepAbove ? a[axis] >= threshold : a[axis] <= threshold;
      const insideB = keepAbove ? b[axis] >= threshold : b[axis] <= threshold;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (threshold - a[axis]) / (b[axis] - a[axis]);
        output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return output;
  };
  for (const triangle of surface.sides[side]) {
    let polygon: Point[] = [...triangle];
    polygon = clip(polygon, 2, zMin, true);
    if (polygon.length < 3) continue;
    polygon = clip(polygon, 2, zMax, false);
    if (polygon.length < 3) continue;
    polygon = clip(polygon, 1, yMin, true);
    if (polygon.length < 3) continue;
    polygon = clip(polygon, 1, yMax, false);
    if (polygon.length < 3) continue;
    const a = new THREE.Vector3(...triangle[0]), b = new THREE.Vector3(...triangle[1]), c = new THREE.Vector3(...triangle[2]);
    const normal = b.sub(a).cross(c.sub(a)).normalize().multiplyScalar(offset);
    for (let i = 1; i < polygon.length - 1; i++) for (const p of [polygon[0], polygon[i], polygon[i + 1]]) {
      positions.push(p[0] + normal.x, p[1] + normal.y, p[2] + normal.z);
      uvs.push(side > 0 ? (zMax - p[2]) / (zMax - zMin) : (p[2] - zMin) / (zMax - zMin), (p[1] - yMin) / (yMax - yMin));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const patch = new THREE.Mesh(geometry, material);
  patch.userData.shipSurfaceDecal = true;
  patch.castShadow = false;
  patch.receiveShadow = true;
  return patch;
}
