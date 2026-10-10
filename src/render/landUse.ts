import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import type { StructureCollider, TreeCollider } from '../sim/collision';

type Point = { x: number; z: number };
type LocalPoint = { t: number; s: number };
type FlightLeg = readonly [Point, Point];

export interface LandUseContext {
  /** Convert local route/lateral coordinates to gameplay X/Z. */
  fromLocal(t: number, s: number): Point;
  terrainHeight(x: number, z: number): number;
  renderedTerrainHeight(x: number, z: number): number | null;
  coastAt(s: number): number;
  flightLegs: readonly FlightLeg[];
  lake: Mission['lake'];
  river: { centerS(t: number): number; halfWidth: number };
  shore?: Mission['shore'];
}

export type VegetationExclusionZone = { x: number; z: number; radius: number };

export interface LandUseStats {
  roadLengthM: number;
  trackLengthM: number;
  fieldCount: number;
  buildingCount: number;
  bridgeCount: number;
  palmCount: number;
  drawCalls: number;
  triangles: number;
}

export interface LandUseResult {
  structureColliders: StructureCollider[];
  treeColliders: TreeCollider[];
  exclusionZones: VegetationExclusionZone[];
  stats: LandUseStats;
  dispose(): void;
}

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const localDistance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function campaignSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function addBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function localPolyline(points: readonly LocalPoint[], spacing = 10): LocalPoint[] {
  if (points.length < 2) return [...points];
  const samples: LocalPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(1, Math.ceil(localDistance(p1, p2) / spacing));
    for (let j = i === 0 ? 0 : 1; j <= steps; j++) {
      const u = j / steps, u2 = u * u, u3 = u2 * u;
      const catmull = (a: number, b: number, c: number, d: number) => .5 * (
        2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3
      );
      samples.push({ t: catmull(p0.t, p1.t, p2.t, p3.t), s: catmull(p0.s, p1.s, p2.s, p3.s) });
    }
  }
  return samples;
}

function polylineLength(points: readonly LocalPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += localDistance(points[i - 1], points[i]);
  return length;
}

function ribbonGeometry(
  points: readonly LocalPoint[],
  width: number,
  fromLocal: (t: number, s: number) => Point,
  groundAt: (x: number, z: number) => number,
  lift = .045,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const half = width * .5;
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const dt = after.t - before.t, ds = after.s - before.s;
    const length = Math.max(.001, Math.hypot(dt, ds));
    const nt = -ds / length, ns = dt / length;
    for (const side of [-1, 1]) {
      const p = { t: points[i].t + nt * half * side, s: points[i].s + ns * half * side };
      const world = fromLocal(p.t, p.s);
      positions.push(world.x, groundAt(world.x, world.z) + lift, world.z);
    }
    if (i < points.length - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function colliderFor(object: THREE.Object3D, label: string): StructureCollider {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  return {
    x: (bounds.min.x + bounds.max.x) * .5,
    z: (bounds.min.z + bounds.max.z) * .5,
    halfWidth: Math.max(.35, (bounds.max.x - bounds.min.x) * .5),
    halfLength: Math.max(.35, (bounds.max.z - bounds.min.z) * .5),
    bottom: bounds.min.y,
    top: bounds.max.y,
    label,
  };
}

function makeStiltHouse(
  root: THREE.Group,
  at: Point,
  ground: number,
  yaw: number,
  scale: number,
  materials: { wall: THREE.Material; roof: THREE.Material; wood: THREE.Material; dark: THREE.Material; glass: THREE.Material },
  label: string,
  colliders: StructureCollider[],
): THREE.Group {
  const home = new THREE.Group();
  home.position.set(at.x, ground, at.z);
  home.rotation.y = yaw;
  const w = 8.2 * scale, d = 10.5 * scale, h = 3.05 * scale, floor = .94 * scale;
  addBox(home, [w, h, d], [0, floor + h / 2, 0], materials.wall);
  for (const x of [-w * .42, w * .42]) for (const z of [-d * .4, d * .4]) {
    addBox(home, [.22 * scale, floor + .1, .22 * scale], [x, floor * .5, z], materials.wood);
  }
  // Two sheet-metal roof planes meet at the ridge and leave a generous eave.
  for (const side of [-1, 1]) {
    const panel = addBox(home, [w * .64, .2 * scale, d * 1.12], [side * w * .225, floor + h + .72 * scale, 0], materials.roof);
    panel.rotation.z = side * -.42;
  }
  addBox(home, [1.35 * scale, 2.0 * scale, .12 * scale], [0, floor + .98 * scale, -d * .505], materials.dark);
  for (const x of [-w * .28, w * .28]) addBox(home, [1.1 * scale, .9 * scale, .1 * scale], [x, floor + 1.55 * scale, -d * .51], materials.glass);
  root.add(home);
  colliders.push(colliderFor(home, label));
  return home;
}

function makeBarn(
  root: THREE.Group,
  at: Point,
  ground: number,
  yaw: number,
  materials: { wall: THREE.Material; roof: THREE.Material; wood: THREE.Material; dark: THREE.Material },
  label: string,
  colliders: StructureCollider[],
): THREE.Group {
  const barn = new THREE.Group();
  barn.position.set(at.x, ground, at.z);
  barn.rotation.y = yaw;
  addBox(barn, [15, 5.4, 12], [0, 2.7, 0], materials.wall);
  for (const side of [-1, 1]) {
    const panel = addBox(barn, [9.4, .24, 13.4], [side * 4.25, 6.18, 0], materials.roof);
    panel.rotation.z = side * -.48;
  }
  addBox(barn, [4.2, 4.2, .18], [0, 2.1, -6.08], materials.wood);
  addBox(barn, [2.2, 3.3, .1], [0, 1.65, -6.2], materials.dark);
  // A pair of pale wall braces gives the large shed a readable rural scale.
  for (const x of [-6.4, 6.4]) addBox(barn, [.16, 4.8, .2], [x, 2.6, -6.12], materials.wood);
  root.add(barn);
  colliders.push(colliderFor(barn, label));
  return barn;
}

type FieldSpec = { t: number; s: number; length: number; width: number; angle: number; crop: 'paddy' | 'orchard' | 'dry' };

function fieldPoint(field: FieldSpec, along: number, across: number): LocalPoint {
  const c = Math.cos(field.angle), s = Math.sin(field.angle);
  return { t: field.t + c * along - s * across, s: field.s + s * along + c * across };
}

function fieldBoundary(field: FieldSpec): LocalPoint[] {
  const l = field.length * .5, w = field.width * .5;
  const chamfer = Math.min(11, l * .12, w * .2);
  return [
    fieldPoint(field, -l + chamfer, -w), fieldPoint(field, l - chamfer, -w),
    fieldPoint(field, l, -w + chamfer), fieldPoint(field, l, w - chamfer),
    fieldPoint(field, l - chamfer, w), fieldPoint(field, -l + chamfer, w),
    fieldPoint(field, -l, w - chamfer), fieldPoint(field, -l, -w + chamfer),
  ];
}

function appendFieldBase(
  positions: number[], colors: number[], indices: number[],
  field: FieldSpec, color: THREE.Color, fromLocal: (t: number, s: number) => Point,
  groundAt: (x: number, z: number) => number,
): void {
  const boundary = fieldBoundary(field);
  const center = fromLocal(field.t, field.s);
  const start = positions.length / 3;
  positions.push(center.x, groundAt(center.x, center.z) + .055, center.z);
  colors.push(color.r, color.g, color.b);
  for (const point of boundary) {
    const world = fromLocal(point.t, point.s);
    positions.push(world.x, groundAt(world.x, world.z) + .045, world.z);
    colors.push(color.r, color.g, color.b);
  }
  for (let i = 0; i < boundary.length; i++) indices.push(start, start + 1 + i, start + 1 + (i + 1) % boundary.length);
}

function appendCropRows(
  positions: number[], colors: number[], indices: number[], field: FieldSpec, color: THREE.Color,
  fromLocal: (t: number, s: number) => Point, groundAt: (x: number, z: number) => number,
): void {
  const rowSpacing = field.crop === 'orchard' ? 6.2 : 4.5;
  const rowCount = Math.floor((field.width - 14) / rowSpacing);
  const segmentCount = Math.max(5, Math.ceil((field.length - 14) / 12));
  for (let row = 0; row < rowCount; row++) {
    const across = -field.width * .5 + 7 + (row + .5) * rowSpacing;
    const start = positions.length / 3;
    for (let segment = 0; segment <= segmentCount; segment++) {
      const along = -field.length * .5 + 7 + segment / segmentCount * (field.length - 14);
      const point = fieldPoint(field, along, across);
      const side = fieldPoint(field, along, across + .28);
      for (const sample of [point, side]) {
        const world = fromLocal(sample.t, sample.s);
        positions.push(world.x, groundAt(world.x, world.z) + .13, world.z);
        colors.push(color.r, color.g, color.b);
      }
      if (segment < segmentCount) {
        const a = start + segment * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
}

function createFrondGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  for (let i = 1; i <= 14; i++) {
    const f = i / 15, z = f * 4.2;
    const y = .58 * Math.sin(f * Math.PI) - 1.55 * f * f;
    const width = .9 * Math.sin(f * Math.PI) * (1 - .45 * f);
    for (const side of [-1, 1]) {
      vertices.push(0, y, z, side * width, y - .2, z + .42, side * .05, y - .13, z + .18);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Adds authored rural land use and returns the exact generated collision geometry. */
export function createLandUse(scene: THREE.Scene, campaign: Campaign, mission: Mission, context: LandUseContext): LandUseResult {
  const root = new THREE.Group();
  root.name = 'Procedural land use';
  scene.add(root);

  const random = seeded(campaignSeed(campaign.id));
  const origin = context.fromLocal(0, 0);
  const along = context.fromLocal(1, 0);
  const across = context.fromLocal(0, 1);
  const tAxis = { x: along.x - origin.x, z: along.z - origin.z };
  const sAxis = { x: across.x - origin.x, z: across.z - origin.z };
  const yawT = Math.atan2(tAxis.x, tAxis.z);
  const localOf = (point: Point): LocalPoint => {
    const dx = point.x - origin.x, dz = point.z - origin.z;
    return { t: dx * tAxis.x + dz * tAxis.z, s: dx * sAxis.x + dz * sAxis.z };
  };
  const toWorld = (point: LocalPoint) => context.fromLocal(point.t, point.s);
  const groundAt = (x: number, z: number) => context.renderedTerrainHeight(x, z) ?? context.terrainHeight(x, z);
  const distanceToLeg = (point: Point, [a, b]: FlightLeg) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const denom = dx * dx + dz * dz;
    const u = denom ? clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / denom, 0, 1) : 0;
    return Math.hypot(point.x - a.x - u * dx, point.z - a.z - u * dz);
  };
  const protectedMarkers = campaign.missions;
  const placementClear = (local: LocalPoint, routeMargin = 240) => {
    const world = toWorld(local);
    const ground = groundAt(world.x, world.z);
    if (!Number.isFinite(ground) || ground < -2 || local.t < context.coastAt(local.s) + 160 || local.t > 6200 || Math.abs(local.s) > 4250) return false;
    if (distance(world, context.lake) < context.lake.radius + 150) return false;
    if (distance(world, mission.fire) < mission.fire.radius + 140 || distance(world, mission.lake) < mission.lake.radius + 150) return false;
    if (protectedMarkers.some(item => distance(world, item.fire) < item.fire.radius + 140 || distance(world, item.lake) < item.lake.radius + 150)) return false;
    if (context.shore && distance(world, context.shore) < 930) return false;
    if (context.flightLegs.some(leg => distanceToLeg(world, leg) < routeMargin)) return false;
    return true;
  };
  const exclusionZones: VegetationExclusionZone[] = [];
  const addExclusion = (local: LocalPoint, radius: number) => {
    const world = toWorld(local);
    exclusionZones.push({ x: world.x, z: world.z, radius });
  };
  const structureColliders: StructureCollider[] = [];
  const treeColliders: TreeCollider[] = [];

  const trackMaterial = new THREE.MeshStandardMaterial({ color: '#8e805f', roughness: 1 });
  const trackEdgeMaterial = new THREE.MeshStandardMaterial({ color: '#716b51', roughness: 1 });
  const fieldBaseMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const cropMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: '#80684b', roughness: .96 });
  const wall = new THREE.MeshStandardMaterial({ color: '#b6ab8e', roughness: .95 });
  const roof = new THREE.MeshStandardMaterial({ color: '#77796c', roughness: .88, metalness: .08 });
  const dark = new THREE.MeshStandardMaterial({ color: '#39413d', roughness: .82 });
  const glass = new THREE.MeshStandardMaterial({ color: '#6e8882', roughness: .35, metalness: .05 });
  const materials = { wall, roof, wood, dark, glass };

  const lakeLocal = localOf(context.lake);
  const shoreLocal = context.shore ? localOf(context.shore) : undefined;
  const villageS = lakeLocal.s + Math.max(520, context.lake.radius * 1.25 + 100);
  const villageT = Math.max(
    lakeLocal.t + 300,
    shoreLocal ? shoreLocal.t + 1050 : -Infinity,
    context.coastAt(villageS) + 620,
  );
  const village: LocalPoint = { t: villageT, s: villageS };
  const hamlet: LocalPoint = { t: 2700, s: 1550 };
  const farmOne: LocalPoint = { t: 3520, s: 1120 };
  const farmTwo: LocalPoint = { t: 4770, s: -1520 };

  const mainRoadLocal: LocalPoint[] = [
    { t: village.t + 95, s: village.s + 48 },
    { t: village.t + 360, s: village.s + 245 },
    { t: 2360, s: 1320 },
    { t: 2850, s: 1500 },
    { t: 3380, s: 1300 },
    { t: 3900, s: 640 },
    { t: 4380, s: -430 },
    { t: 4790, s: -1500 },
  ];
  const mainRoad = localPolyline(mainRoadLocal, 10);
  const roadMaterial = new THREE.MeshStandardMaterial({ color: '#454841', roughness: .98 });
  const roadEdge = new THREE.MeshStandardMaterial({ color: '#80795e', roughness: 1 });
  const addRoad = (points: readonly LocalPoint[]) => {
    const smooth = localPolyline(points, 9);
    const shoulder = new THREE.Mesh(ribbonGeometry(smooth, 10, context.fromLocal, groundAt), roadEdge);
    shoulder.name = 'Rural road shoulder'; shoulder.receiveShadow = true; root.add(shoulder);
    const surface = new THREE.Mesh(ribbonGeometry(smooth, 6, context.fromLocal, groundAt, .065), roadMaterial);
    surface.name = 'Six metre rural road'; surface.receiveShadow = true; root.add(surface);
    for (let i = 0; i < smooth.length; i += 7) addExclusion(smooth[i], 13);
    addExclusion(smooth[smooth.length - 1], 13);
    return polylineLength(smooth);
  };
  let roadLengthM = addRoad(mainRoadLocal);

  const tracks: LocalPoint[][] = [
    [{ t: village.t - 95, s: village.s - 5 }, { t: village.t + 10, s: village.s + 5 }, mainRoadLocal[0]],
    [{ t: 2510, s: 1380 }, { t: 2600, s: 1540 }, { t: 2740, s: 1640 }, { t: 2820, s: 1620 }],
    [{ t: 3250, s: 1350 }, { t: 3380, s: 1220 }, { t: farmOne.t - 20, s: farmOne.s + 90 }],
    [{ t: 3700, s: 880 }, { t: 3720, s: 280 }, { t: 4050, s: -140 }, { t: 4440, s: -700 }, { t: farmTwo.t - 60, s: farmTwo.s + 20 }],
    [{ t: farmTwo.t - 90, s: farmTwo.s - 10 }, { t: farmTwo.t + 60, s: farmTwo.s - 120 }],
  ];
  if (shoreLocal) {
    tracks.push([
      { t: shoreLocal.t + 930, s: 1060 },
      { t: shoreLocal.t + 1180, s: 1190 },
      { t: 2010, s: 1220 },
      { t: 2250, s: 1270 },
    ]);
  }
  let trackLengthM = 0;
  for (const path of tracks) {
    const smooth = localPolyline(path, 9);
    const edge = new THREE.Mesh(ribbonGeometry(smooth, 5, context.fromLocal, groundAt), trackEdgeMaterial);
    edge.name = 'Rural track verge'; edge.receiveShadow = true; root.add(edge);
    const track = new THREE.Mesh(ribbonGeometry(smooth, 3, context.fromLocal, groundAt, .065), trackMaterial);
    track.name = 'Three metre farm track'; track.receiveShadow = true; root.add(track);
    for (let i = 0; i < smooth.length; i += 8) addExclusion(smooth[i], 10);
    addExclusion(smooth[smooth.length - 1], 10);
    trackLengthM += polylineLength(smooth);
  }

  // The road shifts across the drainage corridor once, so a single compact timber bridge
  // carries the paved surface over it. It uses the same local river curve as the world mesh.
  let bridgeCount = 0;
  const crossing = (() => {
    for (let i = 1; i < mainRoad.length; i++) {
      const a = mainRoad[i - 1], b = mainRoad[i];
      const da = a.s - context.river.centerS(a.t), db = b.s - context.river.centerS(b.t);
      if (da === 0 || db === 0 || Math.sign(da) !== Math.sign(db)) {
        const fraction = da === db ? 0 : clamp(da / (da - db), 0, 1);
        const point = { t: a.t + (b.t - a.t) * fraction, s: a.s + (b.s - a.s) * fraction };
        const tangent = { t: b.t - a.t, s: b.s - a.s };
        const tangentLength = Math.max(.001, Math.hypot(tangent.t, tangent.s));
        const rate = Math.abs(db - da) / tangentLength;
        return { point, tangent: { t: tangent.t / tangentLength, s: tangent.s / tangentLength }, length: clamp(2 * context.river.halfWidth / Math.max(.2, rate) + 26, 84, 154) };
      }
    }
    return undefined;
  })();
  if (crossing && placementClear(crossing.point, 180)) {
    const center = toWorld(crossing.point);
    const ground = groundAt(center.x, center.z);
    const tangentWorld = {
      x: tAxis.x * crossing.tangent.t + sAxis.x * crossing.tangent.s,
      z: tAxis.z * crossing.tangent.t + sAxis.z * crossing.tangent.s,
    };
    const bridge = new THREE.Group();
    bridge.name = 'Rural drainage bridge';
    bridge.position.set(center.x, ground + 1.15, center.z);
    bridge.rotation.y = Math.atan2(tangentWorld.x, tangentWorld.z);
    const bridgeDeck = new THREE.MeshStandardMaterial({ color: '#675b45', roughness: .94 });
    const rail = new THREE.MeshStandardMaterial({ color: '#564d3e', roughness: .94 });
    addBox(bridge, [6.8, .48, crossing.length], [0, 0, 0], bridgeDeck);
    for (const side of [-1, 1]) {
      addBox(bridge, [.16, .9, crossing.length], [side * 3.05, .67, 0], rail);
      for (let z = -crossing.length * .45; z <= crossing.length * .45; z += 14) addBox(bridge, [.18, .82, .2], [side * 3.05, .61, z], rail);
    }
    root.add(bridge);
    structureColliders.push(colliderFor(bridge, 'drainage bridge'));
    addExclusion(crossing.point, crossing.length * .65);
    bridgeCount = 1;
  }

  const fieldSpecs: FieldSpec[] = [
    { t: village.t + 265, s: village.s + 275, length: 118, width: 78, angle: .12, crop: 'paddy' },
    { t: 2860, s: 2220, length: 138, width: 84, angle: -.1, crop: 'paddy' },
    { t: 3020, s: 870, length: 114, width: 68, angle: .22, crop: 'dry' },
    { t: 3530, s: 1930, length: 142, width: 86, angle: .06, crop: 'orchard' },
    { t: 3330, s: 430, length: 108, width: 70, angle: -.18, crop: 'dry' },
    { t: 4540, s: -2260, length: 148, width: 92, angle: .08, crop: 'paddy' },
    { t: 5020, s: -1110, length: 126, width: 82, angle: -.16, crop: 'orchard' },
  ];
  const fieldPositions: number[] = [], fieldColors: number[] = [], fieldIndices: number[] = [];
  const cropPositions: number[] = [], cropColors: number[] = [], cropIndices: number[] = [];
  const cropPalette: Record<FieldSpec['crop'], string> = { paddy: '#66733e', orchard: '#6b7847', dry: '#87774c' };
  let fieldCount = 0;
  for (const field of fieldSpecs) {
    if (!placementClear({ t: field.t, s: field.s }, 210)) continue;
    const variation = (random() - .5) * .035;
    const base = new THREE.Color(cropPalette[field.crop]).offsetHSL(0, variation, (random() - .5) * .035);
    const rows = new THREE.Color(field.crop === 'paddy' ? '#83904d' : field.crop === 'orchard' ? '#53683c' : '#9c884f');
    appendFieldBase(fieldPositions, fieldColors, fieldIndices, field, base, context.fromLocal, groundAt);
    appendCropRows(cropPositions, cropColors, cropIndices, field, rows, context.fromLocal, groundAt);
    addExclusion({ t: field.t, s: field.s }, Math.hypot(field.length, field.width) * .53 + 15);
    fieldCount++;
  }
  if (fieldIndices.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(fieldPositions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(fieldColors, 3));
    geometry.setIndex(fieldIndices); geometry.computeVertexNormals();
    const fields = new THREE.Mesh(geometry, fieldBaseMaterial); fields.name = 'Irregular cultivated plots'; fields.receiveShadow = true; root.add(fields);
  }
  if (cropIndices.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(cropPositions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(cropColors, 3));
    geometry.setIndex(cropIndices); geometry.computeVertexNormals();
    const rows = new THREE.Mesh(geometry, cropMaterial); rows.name = 'Crop rows'; rows.receiveShadow = true; root.add(rows);
  }

  let buildingCount = 0;
  const placeHouse = (local: LocalPoint, scale: number, label: string, jitter = 0) => {
    if (!placementClear(local, 200)) return;
    const world = toWorld(local), ground = groundAt(world.x, world.z);
    makeStiltHouse(root, world, ground, yawT + jitter, scale, materials, label, structureColliders);
    addExclusion(local, 24 * scale);
    buildingCount++;
  };
  const placeBarn = (local: LocalPoint, label: string, jitter = 0) => {
    if (!placementClear(local, 200)) return;
    const world = toWorld(local), ground = groundAt(world.x, world.z);
    makeBarn(root, world, ground, yawT + jitter, materials, label, structureColliders);
    addExclusion(local, 34);
    buildingCount++;
  };

  // A roadside lakeside village, followed inland by a smaller hamlet and two working farms.
  for (const [dt, ds, size, turn] of [
    [-115, -65, .94, -.06], [-68, 58, 1.02, .04], [-18, -70, .88, .1],
    [32, 64, 1.04, -.08], [83, -67, .9, .03], [132, 56, 1.08, .08], [184, -53, .94, -.1],
  ] as const) placeHouse({ t: village.t + dt, s: village.s + ds }, size, 'village house', turn);
  addExclusion(village, 235);

  for (const [dt, ds, size, turn] of [
    [-105, -55, .88, -.08], [-56, 57, .92, .04], [-5, -62, .94, .08],
    [50, 48, 1.02, -.06], [106, -40, .9, .1],
  ] as const) placeHouse({ t: hamlet.t + dt, s: hamlet.s + ds }, size, 'inland hamlet house', turn);
  addExclusion(hamlet, 190);

  placeHouse({ t: farmOne.t - 42, s: farmOne.s + 100 }, 1.16, 'farmstead farmhouse', .03);
  placeBarn({ t: farmOne.t + 46, s: farmOne.s - 88 }, 'farmstead barn', -.03);
  placeHouse({ t: farmTwo.t - 36, s: farmTwo.s + 90 }, 1.12, 'farmstead farmhouse', -.04);
  placeBarn({ t: farmTwo.t + 58, s: farmTwo.s - 82 }, 'farmstead barn', .06);
  addExclusion(farmOne, 145); addExclusion(farmTwo, 145);

  // A small grove of palms near the second farm adds a regional landmark and registered canopy.
  const palmCountMax = 35;
  const palmBase = new THREE.CylinderGeometry(.22, .34, 1, 6);
  const palmFrond = createFrondGeometry();
  const palmTrunks = new THREE.InstancedMesh(palmBase, new THREE.MeshStandardMaterial({ color: '#725f46', roughness: 1 }), palmCountMax);
  const palmLeaves = new THREE.InstancedMesh(palmFrond, new THREE.MeshStandardMaterial({ color: '#596f3e', roughness: .96, side: THREE.DoubleSide }), palmCountMax * 7);
  palmTrunks.name = 'Farm palm trunks'; palmLeaves.name = 'Farm palm crowns';
  const dummy = new THREE.Object3D();
  let palmCount = 0;
  for (let row = -2; row <= 2; row++) for (let col = -3; col <= 3; col++) {
    if (palmCount >= palmCountMax) break;
    const local: LocalPoint = { t: 4020 + row * 15 + (random() - .5) * 3, s: 2490 + col * 14 + (random() - .5) * 3 };
    if (!placementClear(local, 260)) continue;
    const world = toWorld(local), ground = groundAt(world.x, world.z), height = 9 + random() * 4;
    dummy.position.set(world.x, ground + height * .5, world.z); dummy.rotation.set(0, random() * TAU, 0); dummy.scale.set(1, height, 1); dummy.updateMatrix();
    palmTrunks.setMatrixAt(palmCount, dummy.matrix);
    for (let frond = 0; frond < 7; frond++) {
      dummy.position.set(world.x, ground + height, world.z);
      dummy.rotation.set(0, frond / 7 * TAU + random() * .18, 0);
      dummy.scale.set(.88 + random() * .22, .82 + random() * .25, .78 + random() * .3);
      dummy.updateMatrix(); palmLeaves.setMatrixAt(palmCount * 7 + frond, dummy.matrix);
    }
    treeColliders.push({ x: world.x, z: world.z, ground, height: height + 4.1, radius: 4.2 });
    addExclusion(local, 7);
    palmCount++;
  }
  palmTrunks.count = palmCount; palmLeaves.count = palmCount * 7;
  if (palmCount) root.add(palmTrunks, palmLeaves);
  addExclusion({ t: 4020, s: 2490 }, 100);

  root.updateMatrixWorld(true);
  const stats: LandUseStats = { roadLengthM, trackLengthM, fieldCount, buildingCount, bridgeCount, palmCount, drawCalls: 0, triangles: 0 };
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) return;
    stats.drawCalls++;
    const geometry = mesh.geometry;
    const indexCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
    const triangles = Math.floor(indexCount / 3);
    stats.triangles += (mesh as THREE.InstancedMesh).isInstancedMesh ? triangles * (mesh as THREE.InstancedMesh).count : triangles;
  });

  return {
    structureColliders,
    treeColliders,
    exclusionZones,
    stats,
    dispose() {
      scene.remove(root);
      const geometries = new Set<THREE.BufferGeometry>();
      const usedMaterials = new Set<THREE.Material>();
      root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (Array.isArray(mesh.material)) mesh.material.forEach(item => usedMaterials.add(item));
        else if (mesh.material) usedMaterials.add(mesh.material);
      });
      geometries.forEach(geometry => geometry.dispose());
      usedMaterials.forEach(material => material.dispose());
    },
  };
}
