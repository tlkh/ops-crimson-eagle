import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import type { StructureCollider, TreeCollider } from '../sim/collision';
import { getCampaignGeography, sampleRoad } from '../content/geography';
import type { BurnField } from './burnField';

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
  /** Building, settlement, and cultivated-land exclusions; road corridors stay burnable. */
  burnExclusionZones: VegetationExclusionZone[];
  stats: LandUseStats;
  applyBurnField(field: BurnField): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const localDistance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);
const smoothBurn = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

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

function cumulativeDistances(points: readonly LocalPoint[]): number[] {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + localDistance(points[i - 1], points[i]));
  return distances;
}

function pointAtDistance(points: readonly LocalPoint[], cumulative: readonly number[], distanceM: number): LocalPoint {
  if (points.length === 0) return { t: 0, s: 0 };
  const distance = clamp(distanceM, 0, cumulative[cumulative.length - 1] ?? 0);
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < distance) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const u = span > 0 ? (distance - cumulative[i - 1]) / span : 0;
  return {
    t: points[i - 1].t + (points[i].t - points[i - 1].t) * u,
    s: points[i - 1].s + (points[i].s - points[i - 1].s) * u,
  };
}

function elevatedRibbonGeometry(
  points: readonly LocalPoint[],
  width: number,
  fromLocal: (t: number, s: number) => Point,
  heightAt: (distanceM: number) => number,
  cumulative: readonly number[],
  lift = 0,
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
      const world = fromLocal(points[i].t + nt * half * side, points[i].s + ns * half * side);
      positions.push(world.x, heightAt(cumulative[i]) + lift, world.z);
    }
    if (i < points.length - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      // Local coordinates map to a right-handed X/Z frame. This winding gives
      // road surfaces upward normals and keeps FrontSide materials visible.
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function railGeometry(
  points: readonly LocalPoint[],
  offset: number,
  fromLocal: (t: number, s: number) => Point,
  heightAt: (distanceM: number) => number,
  cumulative: readonly number[],
  startDistance: number,
  endDistance: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (cumulative[i] < startDistance || cumulative[i] > endDistance) continue;
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const dt = after.t - before.t, ds = after.s - before.s;
    const length = Math.max(.001, Math.hypot(dt, ds));
    const nt = -ds / length, ns = dt / length;
    const world = fromLocal(points[i].t + nt * offset, points[i].s + ns * offset);
    const base = positions.length / 3, deck = heightAt(cumulative[i]);
    positions.push(world.x, deck + .28, world.z, world.x, deck + .92, world.z);
    if (i > 0 && cumulative[i - 1] >= startDistance && cumulative[i - 1] <= endDistance) {
      const prior = base - 2;
      indices.push(prior, base, prior + 1, prior + 1, base, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type RoadStyle = { surfaceWidth: number; shoulderWidth: number; surface: THREE.Material; shoulder: THREE.Material; lengthClass: 'road' | 'track' };

type RiverCrossing = { entryDistance: number; exitDistance: number };

function crossingIntervals(points: readonly LocalPoint[], riverCenter: (t: number) => number, halfWidth: number): RiverCrossing[] {
  if (points.length < 2) return [];
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + localDistance(points[i - 1], points[i]));
  const signed = points.map(point => Math.abs(point.s - riverCenter(point.t)) - halfWidth);
  const crossings: RiverCrossing[] = [];
  let entryDistance: number | undefined = signed[0] <= 0 ? 0 : undefined;
  for (let i = 0; i < points.length - 1; i++) {
    const a = signed[i], b = signed[i + 1];
    if ((a <= 0) === (b <= 0)) continue;
    const fraction = clamp(a / (a - b), 0, 1);
    const distanceAtCrossing = cumulative[i] + (cumulative[i + 1] - cumulative[i]) * fraction;
    if (a > 0) entryDistance = distanceAtCrossing;
    else {
      crossings.push({ entryDistance: entryDistance ?? 0, exitDistance: distanceAtCrossing });
      entryDistance = undefined;
    }
  }
  if (entryDistance !== undefined) crossings.push({ entryDistance, exitDistance: cumulative[cumulative.length - 1] });
  return crossings;
}

function dryRoadRuns(points: readonly LocalPoint[], riverCenter: (t: number) => number, halfWidth: number): LocalPoint[][] {
  if (points.length < 2) return [];
  const value = (point: LocalPoint) => Math.abs(point.s - riverCenter(point.t)) - halfWidth;
  const runs: LocalPoint[][] = [];
  let run: LocalPoint[] = [];
  const close = () => { if (run.length > 1) runs.push(run); run = []; };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], va = value(a), vb = value(b);
    const aDry = va > 0, bDry = vb > 0;
    if (aDry && run.length === 0) run.push(a);
    if (aDry && bDry) run.push(b);
    else if (aDry && !bDry) {
      const u = clamp(va / (va - vb), 0, 1);
      run.push({ t: a.t + (b.t - a.t) * u, s: a.s + (b.s - a.s) * u });
      close();
    } else if (!aDry && bDry) {
      const u = clamp(va / (va - vb), 0, 1);
      run = [{ t: a.t + (b.t - a.t) * u, s: a.s + (b.s - a.s) * u }, b];
    } else close();
  }
  close();
  return runs;
}

function ribbonGeometry(
  points: readonly LocalPoint[],
  width: number,
  fromLocal: (t: number, s: number) => Point,
  groundAt: (x: number, z: number) => number,
  lift = .12,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const half = width * .5;
  const cumulative = cumulativeDistances(points);
  const lengthM = cumulative[cumulative.length - 1] ?? 0;
  const alongSegments = Math.max(14, Math.ceil(lengthM / 2.4));
  const acrossSegments = Math.max(2, Math.ceil(width / 1.8));
  const rowLength = acrossSegments + 1;
  for (let i = 0; i <= alongSegments; i++) {
    const distanceM = lengthM * i / alongSegments;
    const center = pointAtDistance(points, cumulative, distanceM);
    const before = pointAtDistance(points, cumulative, Math.max(0, distanceM - 1));
    const after = pointAtDistance(points, cumulative, Math.min(lengthM, distanceM + 1));
    const dt = after.t - before.t, ds = after.s - before.s;
    const length = Math.max(.001, Math.hypot(dt, ds));
    const nt = -ds / length, ns = dt / length;
    for (let across = 0; across <= acrossSegments; across++) {
      const offset = -half + width * across / acrossSegments;
      const p = { t: center.t + nt * offset, s: center.s + ns * offset };
      const world = fromLocal(p.t, p.s);
      positions.push(world.x, groundAt(world.x, world.z) + lift, world.z);
    }
  }
  for (let i = 0; i < alongSegments; i++) for (let across = 0; across < acrossSegments; across++) {
    const a = i * rowLength + across, b = a + 1, c = a + rowLength, d = c + 1;
    indices.push(a, b, c, b, d, c);
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

function pointInPolygon(point: LocalPoint, polygon: readonly LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.s > point.s) !== (b.s > point.s)
      && point.t < (b.t - a.t) * (point.s - a.s) / (b.s - a.s) + a.t) inside = !inside;
  }
  return inside;
}

function pointToLocalSegment(point: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dt = b.t - a.t, ds = b.s - a.s;
  const lengthSq = dt * dt + ds * ds;
  const u = lengthSq ? clamp(((point.t - a.t) * dt + (point.s - a.s) * ds) / lengthSq, 0, 1) : 0;
  return Math.hypot(point.t - a.t - u * dt, point.s - a.s - u * ds);
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
  const tAxis = { x: along.x - origin.x, z: along.z - origin.z };
  const yawT = Math.atan2(tAxis.x, tAxis.z);
  const toWorld = (point: LocalPoint) => context.fromLocal(point.t, point.s);
  const groundAt = (x: number, z: number) => context.renderedTerrainHeight(x, z) ?? context.terrainHeight(x, z);
  const geography = getCampaignGeography(campaign);
  const settlementPosition = (kind: 'village' | 'hamlet' | 'farm', index = 0): LocalPoint => {
    const settlement = geography.settlements.filter(item => item.kind === kind)[index];
    if (!settlement) throw new Error(`Campaign ${campaign.id} has no ${kind} settlement at index ${index}`);
    return { ...settlement.position };
  };
  const roadPaths = geography.roads.map(road => ({ road, points: sampleRoad(road.points, 8) }));
  const halfWidthFor = (kind: 'paved' | 'gravel' | 'track') => kind === 'paved' ? 5.4 : kind === 'gravel' ? 4.2 : 3.1;
  const distanceToPolyline = (point: LocalPoint, line: readonly LocalPoint[]) => {
    let nearest = Infinity;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dt = b.t - a.t, ds = b.s - a.s;
      const lengthSq = dt * dt + ds * ds;
      const u = lengthSq ? clamp(((point.t - a.t) * dt + (point.s - a.s) * ds) / lengthSq, 0, 1) : 0;
      nearest = Math.min(nearest, Math.hypot(point.t - a.t - u * dt, point.s - a.s - u * ds));
    }
    return nearest;
  };
  const roadClear = (point: LocalPoint, extraRadius: number) => roadPaths.every(({ road, points }) =>
    distanceToPolyline(point, points) > halfWidthFor(road.kind) + extraRadius);
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
  const burnExclusionZones: VegetationExclusionZone[] = [];
  const addExclusion = (local: LocalPoint, radius: number) => {
    const world = toWorld(local);
    const zone = { x: world.x, z: world.z, radius };
    exclusionZones.push(zone);
    burnExclusionZones.push(zone);
  };
  const addRoadExclusion = (local: LocalPoint, radius: number) => {
    const world = toWorld(local);
    exclusionZones.push({ x: world.x, z: world.z, radius });
  };
  const structureColliders: StructureCollider[] = [];
  const treeColliders: TreeCollider[] = [];
  const burnableRoadMeshes: Array<{ mesh: THREE.Mesh; baseColor: THREE.Color }> = [];
  const makeBurnableRoadMesh = (geometry: THREE.BufferGeometry, baseMaterial: THREE.Material, name: string) => {
    const material = baseMaterial.clone();
    const baseColor = material instanceof THREE.MeshStandardMaterial ? material.color.clone() : new THREE.Color('#ffffff');
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color.set('#ffffff');
      material.vertexColors = true;
      material.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    root.add(mesh);
    burnableRoadMeshes.push({ mesh, baseColor });
    return mesh;
  };

  const pavedMaterial = new THREE.MeshStandardMaterial({ color: '#454841', roughness: .98 });
  const pavedShoulderMaterial = new THREE.MeshStandardMaterial({ color: '#80795e', roughness: 1 });
  const gravelMaterial = new THREE.MeshStandardMaterial({ color: '#81765f', roughness: 1 });
  const gravelShoulderMaterial = new THREE.MeshStandardMaterial({ color: '#8f856b', roughness: 1 });
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

  const village = settlementPosition('village');
  const hamlet = settlementPosition('hamlet');
  const farms = geography.settlements.filter(item => item.kind === 'farm').map(item => ({ ...item.position }));
  if (farms.length < 2) throw new Error(`Campaign ${campaign.id} needs two farm settlements for authored buildings`);
  const [farmOne, farmTwo] = farms;
  const bridgeMaterial = new THREE.MeshStandardMaterial({ color: '#675b45', roughness: .94, side: THREE.DoubleSide });
  const bridgeRailMaterial = new THREE.MeshStandardMaterial({ color: '#564d3e', roughness: .94, side: THREE.DoubleSide });
  let roadLengthM = 0, trackLengthM = 0, bridgeCount = 0;
  for (const { road, points } of roadPaths) {
    if (points.length < 2) continue;
    const style: RoadStyle = road.kind === 'paved'
      ? { surfaceWidth: 6, shoulderWidth: 10, surface: pavedMaterial, shoulder: pavedShoulderMaterial, lengthClass: 'road' }
      : road.kind === 'gravel'
        ? { surfaceWidth: 4.5, shoulderWidth: 7.2, surface: gravelMaterial, shoulder: gravelShoulderMaterial, lengthClass: 'road' }
        : { surfaceWidth: 2.8, shoulderWidth: 5.2, surface: trackMaterial, shoulder: trackEdgeMaterial, lengthClass: 'track' };
    const cumulative = cumulativeDistances(points);
    const totalLength = cumulative[cumulative.length - 1];
    if (style.lengthClass === 'track') trackLengthM += totalLength;
    else roadLengthM += totalLength;
    const riverHalfWidth = context.river.halfWidth * 1.22 + style.shoulderWidth * .5 + 4;
    for (const run of dryRoadRuns(points, context.river.centerS, riverHalfWidth)) {
      makeBurnableRoadMesh(ribbonGeometry(run, style.shoulderWidth, context.fromLocal, groundAt, .12), style.shoulder, `${road.kind} road shoulder`);
      makeBurnableRoadMesh(ribbonGeometry(run, style.surfaceWidth, context.fromLocal, groundAt, .22), style.surface, `${road.kind} road surface`);
    }
    const crossings = crossingIntervals(points, context.river.centerS, riverHalfWidth);
    for (const crossing of crossings) {
      // The bridge carries the route from dry ground on both sides. Its end ramps
      // tie the deck into the terrain, while the river gap itself remains clear.
      const rampLength = 12;
      const start = Math.max(0, crossing.entryDistance - rampLength);
      const end = Math.min(totalLength, crossing.exitDistance + rampLength);
      const bridgePoints: LocalPoint[] = [];
      for (let d = start; d < end; d += 4) bridgePoints.push(pointAtDistance(points, cumulative, d));
      bridgePoints.push(pointAtDistance(points, cumulative, end));
      const bridgeCumulative = cumulativeDistances(bridgePoints);
      const localStart = crossing.entryDistance - start, localEnd = crossing.exitDistance - start;
      const startWorld = toWorld(pointAtDistance(points, cumulative, start)), endWorld = toWorld(pointAtDistance(points, cumulative, end));
      const startGround = groundAt(startWorld.x, startWorld.z), endGround = groundAt(endWorld.x, endWorld.z);
      const deckY = Math.max(.65, startGround + .32, endGround + .32);
      const bridgeHeight = (d: number) => {
        if (d < localStart) return THREE.MathUtils.lerp(startGround + .12, deckY, localStart ? d / localStart : 1);
        if (d > localEnd) return THREE.MathUtils.lerp(deckY, endGround + .12, end - start > localEnd ? (d - localEnd) / (end - start - localEnd) : 1);
        return deckY;
      };
      const bridge = new THREE.Group();
      bridge.name = `Rural ${road.kind} drainage bridge`;
      const shoulder = makeBurnableRoadMesh(elevatedRibbonGeometry(bridgePoints, style.shoulderWidth, context.fromLocal, bridgeHeight, bridgeCumulative), style.shoulder, 'Bridge ramp and shoulder');
      bridge.add(shoulder);
      const deck = makeBurnableRoadMesh(elevatedRibbonGeometry(bridgePoints, style.surfaceWidth, context.fromLocal, bridgeHeight, bridgeCumulative, .1), bridgeMaterial, 'Bridge deck and ramp');
      bridge.add(deck);
      const channelStartIndex = bridgeCumulative.findIndex(distanceM => distanceM >= localStart);
      let channelEndIndex = channelStartIndex;
      while (channelEndIndex + 1 < bridgeCumulative.length && bridgeCumulative[channelEndIndex + 1] <= localEnd) channelEndIndex++;
      deck.userData.roadBridge = {
        channelStartIndex,
        channelEndIndex,
        startGroundY: startGround + .22,
        endGroundY: endGround + .22,
        channelDeckY: deckY + .1,
      };
      // Rails only flank the channel span, leaving the approach ramps open.
      for (const side of [-1, 1]) {
        const offset = style.shoulderWidth * .5 + .28;
        const railing = new THREE.Mesh(railGeometry(bridgePoints, offset * side, context.fromLocal, bridgeHeight, bridgeCumulative, localStart, localEnd), bridgeRailMaterial);
        railing.name = 'Bridge guard rail'; bridge.add(railing);
      }
      root.add(bridge);
      structureColliders.push(colliderFor(bridge, `${road.kind} drainage bridge`));
      addRoadExclusion(pointAtDistance(points, cumulative, (start + end) * .5), (end - start) * .5 + style.shoulderWidth);
      bridgeCount++;
    }
    // Dense centerline samples form a continuous buffered vegetation exclusion.
    const exclusionStep = 5;
    for (let d = 0; d <= totalLength; d += exclusionStep) {
      addRoadExclusion(pointAtDistance(points, cumulative, d), style.shoulderWidth * .5 + 8);
    }
    addRoadExclusion(points[points.length - 1], style.shoulderWidth * .5 + 8);
  }

  // Shared geography vertices are literal junctions. A small conforming apron
  // fills the corners where branches with different widths meet.
  const junctions = new Map<string, { point: LocalPoint; kinds: Set<'paved' | 'gravel' | 'track'> }>();
  for (const { road } of roadPaths) for (const point of road.points) {
    const key = `${point.t.toFixed(3)},${point.s.toFixed(3)}`;
    const junction = junctions.get(key) ?? { point, kinds: new Set<'paved' | 'gravel' | 'track'>() };
    junction.kinds.add(road.kind);
    junctions.set(key, junction);
  }
  for (const { point, kinds } of junctions.values()) {
    if (kinds.size < 2) continue;
    const radius = Math.max(...[...kinds].map(kind => halfWidthFor(kind))) + 1.5;
    const positions: number[] = [], indices: number[] = [];
    const center = toWorld(point);
    positions.push(center.x, groundAt(center.x, center.z) + .3, center.z);
    const segments = 20;
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * TAU;
      const world = toWorld({ t: point.t + Math.cos(angle) * radius, s: point.s + Math.sin(angle) * radius });
      positions.push(world.x, groundAt(world.x, world.z) + .3, world.z);
      const next = 1 + (i + 1) % segments;
      indices.push(0, next, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const material = kinds.has('paved') ? pavedMaterial : kinds.has('gravel') ? gravelMaterial : trackMaterial;
    makeBurnableRoadMesh(geometry, material, 'Connected road junction');
  }

  const fieldSpecs: FieldSpec[] = [
    { t: village.t + 280, s: village.s - 260, length: 118, width: 78, angle: .12, crop: 'paddy' },
    { t: hamlet.t + 160, s: hamlet.s + 670, length: 138, width: 84, angle: -.1, crop: 'paddy' },
    { t: hamlet.t + 320, s: hamlet.s - 680, length: 114, width: 68, angle: .22, crop: 'dry' },
    { t: farmOne.t + 10, s: farmOne.s + 810, length: 142, width: 86, angle: .06, crop: 'orchard' },
    { t: farmOne.t - 190, s: farmOne.s - 690, length: 108, width: 70, angle: -.18, crop: 'dry' },
    { t: farmTwo.t - 230, s: farmTwo.s - 740, length: 148, width: 92, angle: .08, crop: 'paddy' },
    { t: farmTwo.t + 250, s: farmTwo.s + 410, length: 126, width: 82, angle: -.16, crop: 'orchard' },
  ];
  const fieldOverlapsRoad = (field: FieldSpec) => {
    const boundary = fieldBoundary(field);
    return roadPaths.some(({ road, points }) => points.some(point => pointInPolygon(point, boundary)
      || boundary.some((vertex, index) => pointToLocalSegment(point, vertex, boundary[(index + 1) % boundary.length]) < halfWidthFor(road.kind) + 5)));
  };
  const fieldPositions: number[] = [], fieldColors: number[] = [], fieldIndices: number[] = [];
  const cropPositions: number[] = [], cropColors: number[] = [], cropIndices: number[] = [];
  const cropPalette: Record<FieldSpec['crop'], string> = { paddy: '#66733e', orchard: '#6b7847', dry: '#87774c' };
  let fieldCount = 0;
  for (const field of fieldSpecs) {
    if (!placementClear({ t: field.t, s: field.s }, 210) || fieldOverlapsRoad(field)) continue;
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
  const drivewayPositions: number[] = [], drivewayIndices: number[] = [];
  const addDriveway = (house: LocalPoint, scale: number) => {
    const start = { t: house.t - 7 * scale, s: house.s };
    let target: LocalPoint | undefined;
    let nearest = Infinity;
    for (const { points } of roadPaths) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dt = b.t - a.t, ds = b.s - a.s;
      const lengthSq = dt * dt + ds * ds;
      const u = lengthSq ? clamp(((start.t - a.t) * dt + (start.s - a.s) * ds) / lengthSq, 0, 1) : 0;
      const projected = { t: a.t + dt * u, s: a.s + ds * u };
      const gap = localDistance(start, projected);
      if (gap < nearest) { nearest = gap; target = projected; }
    }
    if (!target || nearest < 12 || nearest > 72) return;
    const points = sampleRoad([start, target], 4);
    if (points.some(point => {
      const world = toWorld(point);
      return !placementClear(point, 90)
        || Math.abs(point.s - context.river.centerS(point.t)) < context.river.halfWidth * 1.22 + 10
        || groundAt(world.x, world.z) < -2;
    })) return;
    const geometry = ribbonGeometry(points, 2.4, context.fromLocal, groundAt, .2);
    const position = geometry.getAttribute('position');
    const base = drivewayPositions.length / 3;
    for (let i = 0; i < position.count; i++) drivewayPositions.push(position.getX(i), position.getY(i), position.getZ(i));
    if (geometry.index) for (const index of geometry.index.array) drivewayIndices.push(base + index);
    geometry.dispose();
    trackLengthM += nearest;
    for (let d = 0; d <= nearest; d += 4) addRoadExclusion({ t: start.t + (target.t - start.t) * d / nearest, s: start.s + (target.s - start.s) * d / nearest }, 9);
  };
  const placeHouse = (local: LocalPoint, scale: number, label: string, jitter = 0) => {
    if (!placementClear(local, 200) || !roadClear(local, 13 * scale)) return;
    const world = toWorld(local), ground = groundAt(world.x, world.z);
    makeStiltHouse(root, world, ground, yawT + jitter, scale, materials, label, structureColliders);
    addDriveway(local, scale);
    addExclusion(local, 24 * scale);
    buildingCount++;
  };
  const placeBarn = (local: LocalPoint, label: string, jitter = 0) => {
    if (!placementClear(local, 200) || !roadClear(local, 17)) return;
    const world = toWorld(local), ground = groundAt(world.x, world.z);
    makeBarn(root, world, ground, yawT + jitter, materials, label, structureColliders);
    addDriveway(local, 1.1);
    addExclusion(local, 34);
    buildingCount++;
  };

  // A roadside lakeside village, followed inland by a smaller hamlet and two working farms.
  for (const [dt, ds, size, turn] of [
    [-115, 310, .94, -.06], [-68, 360, 1.02, .04], [-18, 300, .88, .1],
    [32, 360, 1.04, -.08], [83, 300, .9, .03], [132, 360, 1.08, .08], [184, 310, .94, -.1],
  ] as const) placeHouse({ t: village.t + dt, s: village.s + ds }, size, 'village house', turn);
  addExclusion(village, 235);

  for (const [dt, ds, size, turn] of [
    [-105, -55, .88, -.08], [-56, 57, .92, .04], [-5, -62, .94, .08],
    [50, 48, 1.02, -.06], [106, -40, .9, .1],
  ] as const) placeHouse({ t: hamlet.t + dt, s: hamlet.s + ds }, size, 'inland hamlet house', turn);
  addExclusion(hamlet, 190);

  placeHouse({ t: farmOne.t - 110, s: farmOne.s + 200 }, 1.16, 'farmstead farmhouse', .03);
  placeBarn({ t: farmOne.t + 120, s: farmOne.s - 190 }, 'farmstead barn', -.03);
  placeHouse({ t: farmTwo.t - 120, s: farmTwo.s + 200 }, 1.12, 'farmstead farmhouse', -.04);
  placeBarn({ t: farmTwo.t + 120, s: farmTwo.s - 230 }, 'farmstead barn', .06);
  addExclusion(farmOne, 145); addExclusion(farmTwo, 145);

  if (drivewayIndices.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(drivewayPositions, 3));
    geometry.setIndex(drivewayIndices); geometry.computeVertexNormals();
    makeBurnableRoadMesh(geometry, trackMaterial, 'Building access tracks');
  }

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
    const local: LocalPoint = { t: farmOne.t + 500 + row * 15 + (random() - .5) * 3, s: farmOne.s + 1370 + col * 14 + (random() - .5) * 3 };
    if (!placementClear(local, 260) || !roadClear(local, 14)) continue;
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
  addExclusion({ t: farmOne.t + 500, s: farmOne.s + 1370 }, 100);

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
    burnExclusionZones,
    stats,
    applyBurnField(field) {
      const singedTint = new THREE.Color('#6b4931');
      const ashTint = new THREE.Color('#746d60');
      const charcoalTint = new THREE.Color('#211f1a');
      for (const { mesh, baseColor } of burnableRoadMeshes) {
        const positions = mesh.geometry.getAttribute('position');
        const colors = new Float32Array(positions.count * 3);
        const color = new THREE.Color();
        for (let index = 0; index < positions.count; index++) {
          const sample = field.sample(positions.getX(index), positions.getZ(index));
          const charCore = smoothBurn(.49, .77, sample.severity) * (1 - .58 * smoothBurn(.28, .94, sample.age));
          const ashLayer = smoothBurn(.23, .56, sample.severity) * smoothBurn(.24, .79, sample.age) * (1 - .28 * charCore);
          const singedFringe = smoothBurn(.012, .16, sample.severity) * (1 - smoothBurn(.36, .68, sample.severity));
          color.copy(baseColor)
            .lerp(singedTint, singedFringe * .74)
            .lerp(ashTint, ashLayer * .76)
            .lerp(charcoalTint, charCore * .94);
          colors[index * 3] = color.r;
          colors[index * 3 + 1] = color.g;
          colors[index * 3 + 2] = color.b;
        }
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
    },
    dispose() {
      scene.remove(root);
      const geometries = new Set<THREE.BufferGeometry>();
      const usedMaterials = new Set<THREE.Material>();
      root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (Array.isArray(mesh.material)) mesh.material.forEach(item => usedMaterials.add(item));
        else if (mesh.material) usedMaterials.add(mesh.material);
      });
      geometries.forEach(geometry => geometry.dispose());
      usedMaterials.forEach(material => material.dispose());
    },
  };
}
