import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import { sampleRoad, type CampaignRoad } from '../content/geography';
import type { TreeCollider } from '../sim/collision';
import { atlasUv, createVegetationAtlases } from './vegetationTextures';
import type { BurnField } from './burnField';
import { ExclusionLookup } from './exclusionLookup';

export type VegetationPoint = { x: number; z: number };
export type VegetationZone = { center: VegetationPoint; radius: number };
export type VegetationVisualTier = 'full' | 'reduced';

/** World placement services supplied by createWorld, kept independent of its geometry helpers. */
export type VegetationContext = {
  fromLocal(t: number, s: number): VegetationPoint;
  local(point: VegetationPoint): { t: number; s: number };
  terrainHeight(x: number, z: number): number;
  coastAt(s: number): number;
  isLake(point: VegetationPoint): boolean;
  riverS(t: number): number;
  flightLegs: readonly (readonly [VegetationPoint, VegetationPoint])[];
  settlementExclusions: readonly VegetationZone[];
  farmExclusions: readonly VegetationZone[];
  /** Road centerlines used for roadside rows, kept separate from their vegetation buffers. */
  roadsideRoads?: readonly CampaignRoad[];
  /** Settlement and cultivated-land exclusions for trees deliberately placed beside roads. */
  roadsideExclusions?: readonly VegetationZone[];
  /** Reduced visuals keep every tree but use a leaner close-range canopy mesh. */
  visualTier?: VegetationVisualTier;
  /** Persistent fire history used to tint existing plants without changing placement. */
  burnField?: BurnField;
};

export type VegetationStats = {
  woodyPlants: number;
  visiblePlants: number;
  broadleaf: number;
  emergent: number;
  secondary: number;
  swamp: number;
  coastal: number;
  palms: number;
  burnedTrees: number;
  fringeTrees: number;
  scorchedTrees: number;
  charredTrees: number;
  damageTriangles: number;
  understory: number;
  reeds: number;
  visualTier: VegetationVisualTier;
  lodCells: { near: number; mid: number; far: number };
};

export type VegetationResult = {
  /** One entry per visible solid woody trunk in either detail tier. */
  treeColliders: TreeCollider[];
  stats: VegetationStats;
  /** Reassigns each spatial batch to a canopy LOD around the active camera. */
  update(camera: THREE.Vector3, quality?: 'high' | 'low'): void;
  dispose(): void;
};

type Species = 'broadleaf' | 'emergent' | 'secondary' | 'swamp' | 'coastal' | 'palm';
export type BurnClassification = 'unburned' | 'fringe' | 'scorched' | 'charred';
type Plant = {
  point: VegetationPoint;
  ground: number;
  height: number;
  radius: number;
  yaw: number;
  trunkScale: number;
  species: Species;
  bark: THREE.Color;
  leaves: THREE.Color;
  rootScale: number;
  burn: BurnClassification;
  burnAge: number;
  burnActivity: number;
};
const canopyProfiles: Record<Species, [number, number, number]> = {
  broadleaf: [1, .94, 1],
  emergent: [1.14, 1.08, 1.14],
  secondary: [.82, 1.2, .84],
  swamp: [1.16, .88, 1.12],
  coastal: [1.26, .8, 1.2],
  palm: [.7, .6, .7],
};

const TAU = Math.PI * 2;
const PLANT_TARGET = 20_000;
const UNDERSTORY_TARGET = 5_600;
const REED_TARGET = 1_100;
const CELL_COLUMNS = 4;
const CELL_ROWS = 3;
const LOCAL_T_MIN = -350;
const LOCAL_T_MAX = 6_450;
const LOCAL_S_MIN = -4_600;
const LOCAL_S_MAX = 4_600;
const HIGH_NEAR_DISTANCE = 220;
const HIGH_MID_DISTANCE = 1_100;
const LOW_NEAR_DISTANCE = 100;
const LOW_MID_DISTANCE = 700;
const distance = (a: VegetationPoint, b: VegetationPoint) => Math.hypot(a.x - b.x, a.z - b.z);

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function classifyBurnSeverity(severity: number): BurnClassification {
  const value = Number.isFinite(severity) ? severity : 0;
  if (value >= .72) return 'charred';
  if (value >= .38) return 'scorched';
  if (value >= .08) return 'fringe';
  return 'unburned';
}

function clampUnit(value: number) {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
}

function tintForBurn(classification: BurnClassification, age: number, activity: number) {
  const ageMix = clampUnit(age);
  const heat = clampUnit(activity);
  if (classification === 'charred') {
    return new THREE.Color('#201e1b')
      .lerp(new THREE.Color('#625b50'), ageMix * .7)
      .lerp(new THREE.Color('#151412'), heat * .22);
  }
  if (classification === 'scorched') {
    return new THREE.Color('#684d35').lerp(new THREE.Color('#74674d'), ageMix * .3)
      .lerp(new THREE.Color('#3e342a'), heat * .16);
  }
  if (classification === 'fringe') {
    return new THREE.Color('#81754b').lerp(new THREE.Color('#908257'), ageMix * .25)
      .lerp(new THREE.Color('#63553b'), heat * .12);
  }
  return new THREE.Color('#ffffff');
}

function applyBurnField(plants: Plant[], field?: BurnField) {
  if (!field) return;
  for (const plant of plants) {
    const sample = field.sample(plant.point.x, plant.point.z);
    plant.burn = classifyBurnSeverity(sample.severity);
    plant.burnAge = clampUnit(sample.age);
    plant.burnActivity = clampUnit(sample.activity);
    if (plant.burn === 'unburned') continue;

    const tint = tintForBurn(plant.burn, plant.burnAge, plant.burnActivity);
    if (plant.burn === 'charred') {
      plant.bark.lerp(tint, .94);
    } else {
      const amount = plant.burn === 'scorched' ? .7 : .42;
      plant.leaves.lerp(tint, amount);
      plant.bark.lerp(tint, plant.burn === 'scorched' ? .2 : .08);
    }
  }
}

function distanceToLeg(point: VegetationPoint, [start, end]: readonly [VegetationPoint, VegetationPoint]) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.z - start.z - t * dz);
}

type CrownLod = 'near' | 'mid' | 'far';
type ActiveCrownLod = CrownLod | 'near-low';

/** A tropical crown is a layered cluster of rounded boughs and small leaf fans. */
function makeCrown(lod: CrownLod, visualTier: VegetationVisualTier): THREE.BufferGeometry {
  const fullNear = lod === 'near' && visualTier === 'full';
  const clusters: Array<[number, number, number, number, number, number, number]> = fullNear
    ? [
      [0, .02, 0, .48, .43, .5, 0],
      [-.42, -.14, .1, .54, .37, .46, 1],
      [.43, -.19, -.1, .55, .36, .51, 2],
      [-.2, .22, -.43, .47, .35, .51, 1],
      [.16, .1, .45, .45, .43, .51, 3],
      [.02, .46, -.08, .42, .34, .43, 0],
      [-.47, -.37, -.2, .38, .29, .37, 2],
    ]
    : lod === 'near'
      ? [
        [0, .02, 0, .5, .44, .51, 0],
        [-.43, -.15, .08, .55, .38, .47, 1],
        [.44, -.18, -.08, .55, .37, .51, 2],
        [-.17, .2, -.43, .48, .36, .51, 1],
        [.15, .12, .45, .46, .42, .52, 3],
      ]
      : lod === 'mid'
        ? [
          [0, .01, 0, .52, .44, .53, 0],
          [-.43, -.15, .08, .56, .38, .48, 1],
          [.44, -.17, -.08, .56, .38, .52, 2],
          [.02, .37, -.04, .46, .36, .46, 3],
        ]
        : [[0, 0, 0, .83, .58, .82, 1]];
  const fanCount = fullNear ? 5 : 0;
  const segments = 5;
  const rings = 3;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  const addLeafMass = (
    center: THREE.Vector3,
    scale: THREE.Vector3,
    rotationY: number,
    tile: number,
    salt: number,
  ) => {
    const geometry = new THREE.SphereGeometry(1, segments, rings);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const rotation = new THREE.Matrix4().makeRotationY(rotationY);
    const point = new THREE.Vector3();
    const jitter = (value: number, seed: number) => Math.sin(value * 8.1 + seed * 2.37) * .026
      + Math.sin(value * 14.7 - seed * 1.93) * .014;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const bump = 1 + jitter(x + z * 1.7, salt) * (lod === 'near' ? 1 : .45);
      point.set(x * scale.x * bump, y * scale.y * bump, z * scale.z * bump).applyMatrix4(rotation).add(center);
      positions.push(point.x, point.y, point.z);
      const [u, v] = atlasUv(uv.getX(i), uv.getY(i), tile);
      uvs.push(u, v);
    }
    const sourceIndices = geometry.getIndex();
    if (sourceIndices) {
      for (let i = 0; i < sourceIndices.count; i++) indices.push(vertexOffset + sourceIndices.getX(i));
    }
    vertexOffset += position.count;
    geometry.dispose();
  };

  for (let i = 0; i < clusters.length; i++) {
    const [x, y, z, sx, sy, sz, tile] = clusters[i];
    addLeafMass(new THREE.Vector3(x, y, z), new THREE.Vector3(sx, sy, sz), i * .41, tile, i + 2);
  }
  for (let i = 0; i < fanCount; i++) {
    const angle = i / fanCount * TAU + .21;
    const center = new THREE.Vector3(Math.cos(angle) * .54, -.23 + (i % 2) * .1, Math.sin(angle) * .54);
    addLeafMass(center, new THREE.Vector3(.22, .1, .39), angle, (i + 1) % 4, i + 11);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}

/** One tapered bole with three compact buttress roots, instanced for every solid tree. */
function makeTrunk(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(.12, .25, 1, 5, 1, false);
  trunk.translate(0, .5, 0);
  const pieces: Array<{ geometry: THREE.BufferGeometry; tile: number }> = [{ geometry: trunk, tile: 0 }];
  for (let root = 0; root < 3; root++) {
    const angle = root * TAU / 3 + .18;
    const start = new THREE.Vector3(0, .31, 0);
    const end = new THREE.Vector3(Math.cos(angle) * .66, .018, Math.sin(angle) * .66);
    const delta = end.clone().sub(start);
    const flare = new THREE.CylinderGeometry(.16, .035, delta.length(), 3, 1, false);
    flare.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
    flare.translate(...start.add(end).multiplyScalar(.5).toArray());
    pieces.push({ geometry: flare, tile: root + 1 });
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const { geometry: piece, tile } of pieces) {
    const attribute = piece.getAttribute('position');
    const uv = piece.getAttribute('uv');
    for (let i = 0; i < attribute.count; i++) {
      positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
      const mapped = atlasUv(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0, tile);
      uvs.push(...mapped);
    }
    const index = piece.getIndex();
    if (index) for (let i = 0; i < index.count; i++) indices.push(offset + index.getX(i));
    else for (let i = 0; i < attribute.count; i++) indices.push(offset + i);
    offset += attribute.count;
    piece.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}

/** Four tapered, forked boughs form a sparse 3D silhouette inside the former crown envelope. */
function makeDeadBranches(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const addSegment = (start: THREE.Vector3, end: THREE.Vector3, baseRadius: number, tipRadius: number) => {
    const delta = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(tipRadius, baseRadius, delta.length(), 4, 1, true);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, delta.clone().normalize()));
    geometry.translate(...start.clone().add(end).multiplyScalar(.5).toArray());
    pieces.push(geometry);
  };
  const addBough = (angle: number, reach: number, tipY: number) => {
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const tangent = new THREE.Vector3(-direction.z, 0, direction.x);
    const start = new THREE.Vector3(0, -.12, 0);
    const middle = direction.clone().multiplyScalar(reach * .48).setY(-.02 + tipY * .4);
    const tip = direction.clone().multiplyScalar(reach).setY(tipY);
    const fork = direction.clone().multiplyScalar(reach * .77)
      .add(tangent.clone().multiplyScalar(reach * .2)).setY(Math.min(.45, middle.y + .2));
    addSegment(start, middle, .082, .055);
    addSegment(middle, tip, .055, .022);
    addSegment(middle, fork, .048, .018);
  };
  addBough(.18, .92, -.42);
  addBough(1.72, .82, .5);
  addBough(3.28, .96, .34);
  addBough(4.76, .84, -.36);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  for (const piece of pieces) {
    const attribute = piece.getAttribute('position');
    const uv = piece.getAttribute('uv');
    for (let i = 0; i < attribute.count; i++) {
      positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
      const [u, v] = atlasUv(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0, 0);
      uvs.push(u, v);
    }
    const index = piece.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(vertexOffset + index.getX(i));
    } else {
      for (let i = 0; i < attribute.count; i++) indices.push(vertexOffset + i);
    }
    vertexOffset += attribute.count;
    piece.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Feathery palm pinnae on a bowed rachis; each instance is one frond. */
function makePalmFrond(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const segments = 9;
  for (let i = 0; i < segments; i++) {
    const t = (i + .2) / segments;
    const z = t * 4.4;
    const y = .4 * Math.sin(t * Math.PI) - .78 * t * t;
    const width = .48 * Math.sin(t * Math.PI) * (1 - .18 * t);
    for (const side of [-1, 1]) {
      const color = .78 + t * .12 + (side > 0 ? .025 : 0);
      positions.push(0, y, z, side * width, y - .1, z + .33, side * .04, y - .04, z + .16);
      colors.push(color, color * 1.03, color * .88, color * .97, color, color * .82, color * .86, color * .91, color * .75);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function randomLeafColor(rng: () => number, species: Species, t: number, s: number) {
  const palette: Record<Species, [number, number, number]> = {
    broadleaf: [.265, .31, .235],
    emergent: [.245, .29, .22],
    secondary: [.29, .34, .255],
    swamp: [.255, .32, .235],
    coastal: [.275, .34, .235],
    palm: [.29, .38, .25],
  };
  const [hue, saturation, lightness] = palette[species];
  return new THREE.Color().setHSL(
    hue + Math.sin(t * .0023 + s * .0017) * .009 + (rng() - .5) * .016,
    saturation + (rng() - .5) * .08,
    lightness + (rng() - .5) * .055,
  ).convertSRGBToLinear();
}

function chooseSpecies(
  rng: () => number,
  coastDistance: number,
  riverDistance: number,
  canopyNoise: number,
  t: number,
  s: number,
): Species {
  if (coastDistance < 350 && rng() < .68) return 'coastal';
  if (riverDistance > 48 && riverDistance < 310 && rng() < .48) return 'swamp';
  const secondaryBand = Math.sin(t * .00115 + 1.3) * Math.cos(s * .00135 - .6);
  if (coastDistance > 250 && rng() < .035 + Math.max(0, secondaryBand) * .055) return 'palm';
  if (canopyNoise > .62 && coastDistance > 400 && rng() < .12) return 'emergent';
  if (canopyNoise < -.12 || secondaryBand < -.38) return 'secondary';
  return 'broadleaf';
}

function shapeFor(species: Species, rng: () => number, routeDistance: number) {
  let height: number;
  let radius: number;
  switch (species) {
    case 'emergent': height = 28 + rng() * 12; radius = 4.3 + rng() * 1.8; break;
    case 'secondary': height = 8.5 + rng() * 10; radius = 2.6 + rng() * 1.6; break;
    case 'swamp': height = 13 + rng() * 10; radius = 3.2 + rng() * 1.35; break;
    case 'coastal': height = 6 + rng() * 8; radius = 2.55 + rng() * 1.2; break;
    case 'palm': height = 11 + rng() * 9; radius = 4.7 + rng() * 1.5; break;
    default: height = 17 + rng() * 11; radius = 3.7 + rng() * 1.7; break;
  }

  // Flight legs stay visibly open. Emergent crowns are kept away from them entirely;
  // trees near the route shoulder step down to a secondary canopy height.
  if (species === 'emergent' && routeDistance < 205) {
    species = 'broadleaf';
    height = 18 + rng() * 6;
    radius = 3.6 + rng() * 1.1;
  }
  if (routeDistance < 190) {
    const shoulder = Math.max(0, Math.min(1, (routeDistance - 72) / 118));
    const ceiling = 8 + shoulder * 12;
    height = Math.min(height, ceiling);
    radius = Math.min(radius, 3.9);
  }
  return { species, height, radius };
}

function inZones(point: VegetationPoint, zones: readonly VegetationZone[], margin: number) {
  return zones.some(zone => distance(point, zone.center) < zone.radius + margin);
}

function makePlantField(campaign: Campaign, mission: Mission, context: VegetationContext, settlementLookup: ExclusionLookup) {
  const seed = campaign.id === 'jp_ketapang_2026_09' ? 62017 : 62135;
  const rng = seeded(seed);
  const plants: Plant[] = [];
  const colliders: TreeCollider[] = [];
  const roadsideLookup = new ExclusionLookup(
    [...context.settlementExclusions, ...(context.roadsideExclusions ?? [])].map(zone => ({
      x: zone.center.x,
      z: zone.center.z,
      radius: zone.radius,
    })),
  );
  const missionFireZones = campaign.missions.map(item => ({ center: item.fire, radius: item.fire.radius + 46 }));
  const coast = context.coastAt(0);
  const roadHalfWidth = (kind: CampaignRoad['kind']) => kind === 'paved' ? 5.4 : kind === 'gravel' ? 4.2 : 3.1;
  const roadPaths = (context.roadsideRoads ?? []).map(road => ({ road, points: sampleRoad(road.points, 8) }));
  const distanceToRoad = (point: VegetationPoint, line: readonly { t: number; s: number }[]) => {
    const local = context.local(point);
    let nearest = Infinity;
    for (let index = 1; index < line.length; index++) {
      const a = line[index - 1], b = line[index];
      const dt = b.t - a.t, ds = b.s - a.s;
      const lengthSquared = dt * dt + ds * ds;
      const fraction = lengthSquared === 0 ? 0 : THREE.MathUtils.clamp(
        ((local.t - a.t) * dt + (local.s - a.s) * ds) / lengthSquared, 0, 1,
      );
      nearest = Math.min(nearest, Math.hypot(local.t - a.t - fraction * dt, local.s - a.s - fraction * ds));
    }
    return nearest;
  };
  const makeTree = (point: VegetationPoint, ground: number, local: { t: number; s: number }, rng: () => number, routeDistance: number): Plant => {
    const coastDistance = local.t - context.coastAt(local.s);
    const riverDistance = Math.abs(local.s - context.riverS(local.t));
    const canopyNoise = Math.sin(local.t * .0046 + 1.1) * Math.cos(local.s * .0039 - .6)
      + .3 * Math.sin((local.t + local.s) * .0091);
    const species = chooseSpecies(rng, coastDistance, riverDistance, canopyNoise, local.t, local.s);
    const shape = shapeFor(species, rng, routeDistance);
    const yaw = rng() * TAU;
    const trunkScale = shape.species === 'coastal' ? .85 + rng() * .45 : .68 + rng() * .48;
    const bark = new THREE.Color().setHSL(.075 + rng() * .025, .16 + rng() * .08, .20 + rng() * .08).convertSRGBToLinear();
    return {
      point,
      ground,
      height: shape.height,
      radius: shape.radius,
      yaw,
      trunkScale,
      species: shape.species,
      bark,
      leaves: randomLeafColor(rng, shape.species, local.t, local.s),
      rootScale: shape.species === 'coastal' || shape.species === 'swamp' ? .58 + rng() * .65 : 0,
      burn: 'unburned',
      burnAge: 0,
      burnActivity: 0,
    };
  };
  const addTree = (plant: Plant) => {
    plants.push(plant);
    colliders.push({
      x: plant.point.x,
      z: plant.point.z,
      ground: plant.ground,
      height: plant.height,
      radius: plant.radius,
    });
  };

  // Seed an irregular but recognizable tree line along both shoulders of each
  // authored road. General forest placement still respects the full road buffer.
  for (let roadIndex = 0; roadIndex < roadPaths.length; roadIndex++) {
    const { road } = roadPaths[roadIndex];
    const samples = sampleRoad(road.points, 48);
    const rowRandom = seeded(seed ^ Math.imul(roadIndex + 1, 0x9e3779b9));
    for (let index = 1; index < samples.length - 1; index++) {
      const previous = samples[index - 1], center = samples[index], next = samples[index + 1];
      const dt = next.t - previous.t, ds = next.s - previous.s;
      const length = Math.hypot(dt, ds);
      if (length < 1) continue;
      const tangent = { t: dt / length, s: ds / length };
      const normal = { t: -tangent.s, s: tangent.t };
      for (const side of [-1, 1]) {
        const alongJitter = (rowRandom() - .5) * 7;
        const offset = roadHalfWidth(road.kind) + 11 + rowRandom() * 2.4;
        const local = {
          t: center.t + tangent.t * alongJitter + normal.t * side * offset,
          s: center.s + tangent.s * alongJitter + normal.s * side * offset,
        };
        if (local.t < context.coastAt(local.s) + 58 || local.t > 6_400 || Math.abs(local.s) > 4_540) continue;
        const point = context.fromLocal(local.t, local.s);
        const ground = context.terrainHeight(point.x, point.z);
        if (!Number.isFinite(ground) || ground < -4 || context.isLake(point)) continue;
        if (Math.abs(local.s - context.riverS(local.t)) < 52) continue;
        if (roadsideLookup.contains(point.x, point.z, 25) || inZones(point, missionFireZones, 0)) continue;
        if (mission.shore && distance(point, mission.shore) < 900) continue;

        // Keep rows out of intersections and away from flight paths, where
        // rotor clearance takes priority over roadside continuity.
        if (roadPaths.some((other, otherIndex) => otherIndex !== roadIndex
          && distanceToRoad(point, other.points) < roadHalfWidth(other.road.kind) + 10)) continue;
        let routeDistance = Infinity;
        for (const leg of context.flightLegs) routeDistance = Math.min(routeDistance, distanceToLeg(point, leg));
        const plant = makeTree(point, ground, local, rowRandom, routeDistance);
        const routeClearance = plant.species === 'emergent' ? 170 + plant.radius : 61 + plant.radius;
        if (routeDistance < routeClearance) continue;
        addTree(plant);
      }
    }
  }

  let tries = 0;
  const maxTries = PLANT_TARGET * 32;

  while (plants.length < PLANT_TARGET && tries++ < maxTries) {
    const band = rng();
    let t: number;
    let s: number;
    if (band < .68) {
      t = coast + 95 + rng() * 2_950;
      s = (rng() - .5) * 5_800;
    } else if (band < .94) {
      t = coast + 120 + rng() * 4_950;
      s = (rng() - .5) * 8_400;
    } else {
      s = (rng() - .5) * 8_600;
      t = context.coastAt(s) + 78 + rng() * 320;
    }
    if (Math.abs(s) > 4_540 || t < context.coastAt(s) + 58 || t > 6_300) continue;
    const point = context.fromLocal(t, s);
    if (context.isLake(point)) continue;
    const ground = context.terrainHeight(point.x, point.z);
    if (ground < -4) continue;
    const local = context.local(point);
    const riverDistance = Math.abs(local.s - context.riverS(local.t));
    if (riverDistance < 52) continue;
    if (settlementLookup.contains(point.x, point.z, 25) || inZones(point, missionFireZones, 0)) continue;
    if (mission.shore && distance(point, mission.shore) < 900) continue;

    let routeDistance = Infinity;
    for (const leg of context.flightLegs) routeDistance = Math.min(routeDistance, distanceToLeg(point, leg));

    // Multi-scale stand structure gives irregular dense pockets instead of a uniform grid.
    const standNoise = Math.sin(t * .0018 + .45) * Math.cos(s * .00155 - .8)
      + .36 * Math.sin((t + s) * .0038) + .17 * Math.cos((t - s) * .0062);
    const patchProbability = Math.max(.2, Math.min(.92, .56 + standNoise * .24));
    if (rng() > patchProbability) continue;

    // Use the same final tree construction as roadside rows; this shared path
    // keeps all species, burn tinting, visuals, and colliders consistent.
    const plant = makeTree(point, ground, local, rng, routeDistance);
    // Leave room for rotor radius and collision padding around marked flight legs.
    const routeClearance = plant.species === 'emergent' ? 170 + plant.radius : 61 + plant.radius;
    if (routeDistance < routeClearance) continue;
    addTree(plant);
  }

  return { plants, colliders };
}

/** Creates deterministic tropical woodland in spatial batches with camera-driven crown LOD. */
export function createVegetation(
  scene: THREE.Scene,
  campaign: Campaign,
  mission: Mission,
  context: VegetationContext,
): VegetationResult {
  const settlementLookup = new ExclusionLookup(
    [...context.settlementExclusions, ...context.farmExclusions].map(zone => ({
      x: zone.center.x,
      z: zone.center.z,
      radius: zone.radius,
    })),
  );
  const { plants, colliders } = makePlantField(campaign, mission, context, settlementLookup);
  applyBurnField(plants, context.burnField);
  const visualTier = context.visualTier ?? 'full';
  const foliageAtlas = createVegetationAtlases();
  const crownGeometries = new Map<CrownLod, THREE.BufferGeometry>([
    ['near', makeCrown('near', visualTier)],
    ['mid', makeCrown('mid', visualTier)],
    ['far', makeCrown('far', visualTier)],
  ]);
  const lowNearGeometry = makeCrown('near', 'reduced');
  const foliageMaterial = new THREE.MeshStandardMaterial({ map: foliageAtlas.foliage, color: '#ffffff', roughness: .98 });
  const barkMaterial = new THREE.MeshStandardMaterial({ map: foliageAtlas.bark, color: '#ffffff', roughness: 1 });
  const deadBranchMaterial = new THREE.MeshStandardMaterial({
    map: foliageAtlas.bark, color: '#ffffff', roughness: 1, side: THREE.DoubleSide,
  });
  const palmMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .96, side: THREE.DoubleSide });
  const trunkGeometry = makeTrunk();
  const deadBranchGeometry = makeDeadBranches();
  const frondGeometry = makePalmFrond();
  const dummy = new THREE.Object3D();
  type CellBatch = {
    bounds: { tMin: number; tMax: number; sMin: number; sMax: number };
    crown: THREE.InstancedMesh;
    crownLod: ActiveCrownLod;
    trunk: THREE.InstancedMesh;
    fronds?: THREE.InstancedMesh;
  };
  const cells: Plant[][] = Array.from({ length: CELL_COLUMNS * CELL_ROWS }, () => []);
  for (const plant of plants) {
    const local = context.local(plant.point);
    const column = THREE.MathUtils.clamp(Math.floor((local.t - LOCAL_T_MIN) / (LOCAL_T_MAX - LOCAL_T_MIN) * CELL_COLUMNS), 0, CELL_COLUMNS - 1);
    const row = THREE.MathUtils.clamp(Math.floor((local.s - LOCAL_S_MIN) / (LOCAL_S_MAX - LOCAL_S_MIN) * CELL_ROWS), 0, CELL_ROWS - 1);
    cells[row * CELL_COLUMNS + column].push(plant);
  }

  const cellBatches: CellBatch[] = [];
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    const items = cells[cellIndex];
    if (items.length === 0) continue;
    const row = Math.floor(cellIndex / CELL_COLUMNS);
    const column = cellIndex % CELL_COLUMNS;
    const tMin = LOCAL_T_MIN + column / CELL_COLUMNS * (LOCAL_T_MAX - LOCAL_T_MIN);
    const tMax = LOCAL_T_MIN + (column + 1) / CELL_COLUMNS * (LOCAL_T_MAX - LOCAL_T_MIN);
    const sMin = LOCAL_S_MIN + row / CELL_ROWS * (LOCAL_S_MAX - LOCAL_S_MIN);
    const sMax = LOCAL_S_MIN + (row + 1) / CELL_ROWS * (LOCAL_S_MAX - LOCAL_S_MIN);
    const crowns = items.filter(plant => plant.species !== 'palm' && plant.burn !== 'charred');
    const palmPlants = items.filter(plant => plant.species === 'palm');
    const suffix = cellIndex === 0 ? '' : ` cell ${cellIndex}`;
    const trunk = new THREE.InstancedMesh(trunkGeometry, barkMaterial, items.length);
    trunk.name = `lowland tree boles${suffix}`;
    trunk.castShadow = false;
    trunk.receiveShadow = false;
    trunk.count = items.length;

    const crown = new THREE.InstancedMesh(crownGeometries.get('far')!, foliageMaterial, crowns.length);
    crown.name = `lowland tropical canopy${suffix}`;
    crown.castShadow = false;
    crown.receiveShadow = false;
    crown.count = crowns.length;

    let fronds: THREE.InstancedMesh | undefined;
    if (palmPlants.length > 0) {
      fronds = new THREE.InstancedMesh(frondGeometry, palmMaterial, palmPlants.length * 7);
      fronds.name = `palm fronds${suffix}`;
      fronds.castShadow = false;
      fronds.receiveShadow = false;
      fronds.count = palmPlants.length * 7;
    }

    let trunkIndex = 0;
    for (const plant of items) {
      const { x, z } = plant.point;
      dummy.position.set(x, plant.ground, z);
      dummy.rotation.set(0, plant.yaw, 0);
      const buttressScale = 1 + plant.rootScale * .16;
      dummy.scale.set(plant.trunkScale * buttressScale, plant.height, plant.trunkScale * buttressScale);
      dummy.updateMatrix();
      trunk.setMatrixAt(trunkIndex, dummy.matrix);
      trunk.setColorAt(trunkIndex++, plant.bark);
    }

    for (let i = 0; i < crowns.length; i++) {
      const plant = crowns[i];
      const [width, height, depth] = canopyProfiles[plant.species];
      const crownHeight = plant.ground + plant.height * (plant.species === 'secondary' ? .9 : .88);
      dummy.position.set(plant.point.x, crownHeight, plant.point.z);
      dummy.rotation.set(0, plant.yaw, 0);
      dummy.scale.set(plant.radius * width, plant.radius * height, plant.radius * depth);
      dummy.updateMatrix();
      crown.setMatrixAt(i, dummy.matrix);
      crown.setColorAt(i, plant.leaves);
    }

    if (fronds) {
      let frondIndex = 0;
      for (const plant of palmPlants) {
        if (plant.burn === 'charred') continue;
        const { x, z } = plant.point;
        const top = plant.ground + plant.height;
        const frondTint = tintForBurn(plant.burn, plant.burnAge, plant.burnActivity);
        for (let frond = 0; frond < 7; frond++) {
          const angle = plant.yaw + frond / 7 * TAU;
          dummy.position.set(x, top, z);
          dummy.quaternion.setFromEuler(new THREE.Euler(.38 + (frond % 2) * .08, angle, (frond % 2 ? -1 : 1) * .12));
          dummy.scale.setScalar(.76 + (frond % 3) * .08);
          dummy.updateMatrix();
          fronds.setMatrixAt(frondIndex++, dummy.matrix);
          fronds.setColorAt(frondIndex - 1, frondTint);
        }
      }
      fronds.count = frondIndex;
      fronds.instanceMatrix.needsUpdate = true;
      if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
    }

    trunk.instanceMatrix.needsUpdate = true;
    if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
    crown.instanceMatrix.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    scene.add(trunk, crown);
    if (fronds) scene.add(fronds);
    cellBatches.push({ bounds: { tMin, tMax, sMin, sMax }, crown, crownLod: 'far', trunk, fronds });
  }

  const charredPlants = plants.filter(plant => plant.burn === 'charred');
  let deadBranches: THREE.InstancedMesh | undefined;
  if (charredPlants.length > 0) {
    deadBranches = new THREE.InstancedMesh(deadBranchGeometry, deadBranchMaterial, charredPlants.length);
    deadBranches.name = 'charred dead branches';
    deadBranches.castShadow = false;
    deadBranches.receiveShadow = false;
    for (let i = 0; i < charredPlants.length; i++) {
      const plant = charredPlants[i];
      const [width, height, depth] = canopyProfiles[plant.species];
      const crownHeight = plant.ground + plant.height * (plant.species === 'secondary' ? .9 : .88);
      dummy.position.set(plant.point.x, crownHeight, plant.point.z);
      dummy.rotation.set(0, plant.yaw, 0);
      dummy.scale.set(plant.radius * width, plant.radius * height, plant.radius * depth);
      dummy.updateMatrix();
      deadBranches.setMatrixAt(i, dummy.matrix);
      deadBranches.setColorAt(i, plant.bark);
    }
    deadBranches.instanceMatrix.needsUpdate = true;
    if (deadBranches.instanceColor) deadBranches.instanceColor.needsUpdate = true;
    scene.add(deadBranches);
  }

  const understoryGeometry = new THREE.IcosahedronGeometry(1, 0);
  const understoryMaterial = new THREE.MeshStandardMaterial({ color: '#68794b', map: foliageAtlas.foliage, roughness: 1 });
  const understory = new THREE.InstancedMesh(understoryGeometry, understoryMaterial, UNDERSTORY_TARGET);
  understory.name = 'forest understory';
  understory.castShadow = false;
  understory.receiveShadow = false;
  const reedGeometry = new THREE.ConeGeometry(.7, 1, 4, 1);
  const reedMaterial = new THREE.MeshStandardMaterial({ color: '#8c8d5b', roughness: 1 });
  const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, REED_TARGET);
  reeds.name = 'lake-edge reeds';
  reeds.castShadow = false;
  reeds.receiveShadow = false;

  const rng = seeded((campaign.id === 'jp_ketapang_2026_09' ? 62017 : 62135) ^ 0x9e3779b9);
  const missionFireZones = campaign.missions.map(item => ({ center: item.fire, radius: item.fire.radius + 46 }));
  let understoryCount = 0;
  let understoryTries = 0;
  while (understoryCount < UNDERSTORY_TARGET && understoryTries++ < UNDERSTORY_TARGET * 8) {
    const t = context.coastAt(0) + 90 + rng() * 3_000;
    const s = (rng() - .5) * 5_600;
    const point = context.fromLocal(t, s);
    if (context.isLake(point) || context.terrainHeight(point.x, point.z) < -4) continue;
    if (settlementLookup.contains(point.x, point.z, 20) || inZones(point, missionFireZones, 0)) continue;
    if (mission.shore && distance(point, mission.shore) < 900) continue;
    if (Math.abs(s - context.riverS(t)) < 58) continue;
    let routeDistance = Infinity;
    for (const leg of context.flightLegs) routeDistance = Math.min(routeDistance, distanceToLeg(point, leg));
    if (routeDistance < 70 || rng() < .22) continue;
    const scale = 1.1 + rng() * 1.8;
    dummy.position.set(point.x, context.terrainHeight(point.x, point.z) + scale * .34, point.z);
    dummy.scale.set(scale, scale * (.58 + rng() * .38), scale * (.82 + rng() * .35));
    dummy.rotation.set(0, rng() * TAU, 0);
    dummy.updateMatrix();
    understory.setMatrixAt(understoryCount, dummy.matrix);
    const leafColor = randomLeafColor(rng, 'secondary', t, s);
    const burnSample = context.burnField?.sample(point.x, point.z);
    if (burnSample) {
      const burn = classifyBurnSeverity(burnSample.severity);
      if (burn !== 'unburned') {
        const amount = burn === 'charred' ? .88 : burn === 'scorched' ? .68 : .4;
        leafColor.lerp(tintForBurn(burn, burnSample.age, burnSample.activity), amount);
      }
    }
    understory.setColorAt(understoryCount++, leafColor);
  }
  understory.count = understoryCount;
  understory.instanceMatrix.needsUpdate = true;
  if (understory.instanceColor) understory.instanceColor.needsUpdate = true;

  let reedCount = 0;
  for (let i = 0; i < REED_TARGET; i++) {
    const angle = rng() * TAU;
    const radial = mission.lake.radius * (1.025 + rng() * .055);
    const x = mission.lake.x + Math.cos(angle) * radial;
    const z = mission.lake.z - Math.sin(angle) * radial;
    dummy.position.set(x, .4 + rng() * .22, z);
    dummy.scale.set(.35 + rng() * .55, .75 + rng() * 1.5, .35 + rng() * .55);
    dummy.rotation.set(0, rng() * TAU, 0);
    dummy.updateMatrix();
    reeds.setMatrixAt(reedCount++, dummy.matrix);
  }
  reeds.count = reedCount;
  reeds.instanceMatrix.needsUpdate = true;

  scene.add(understory, reeds);

  const totals: Record<Species, number> = {
    broadleaf: 0, emergent: 0, secondary: 0, swamp: 0, coastal: 0, palm: 0,
  };
  for (const plant of plants) totals[plant.species]++;
  const branchTriangleCount = (deadBranchGeometry.getIndex()?.count ?? deadBranchGeometry.getAttribute('position').count) / 3;
  const stats: VegetationStats = {
    woodyPlants: plants.length,
    visiblePlants: cellBatches.reduce((sum, cell) => sum + cell.trunk.count, 0),
    broadleaf: totals.broadleaf,
    emergent: totals.emergent,
    secondary: totals.secondary,
    swamp: totals.swamp,
    coastal: totals.coastal,
    palms: totals.palm,
    burnedTrees: plants.filter(plant => plant.burn !== 'unburned').length,
    fringeTrees: plants.filter(plant => plant.burn === 'fringe').length,
    scorchedTrees: plants.filter(plant => plant.burn === 'scorched').length,
    charredTrees: charredPlants.length,
    damageTriangles: charredPlants.length * branchTriangleCount,
    understory: understoryCount,
    reeds: reedCount,
    visualTier,
    lodCells: { near: 0, mid: 0, far: cellBatches.length },
  };

  const update = (camera: THREE.Vector3, quality: 'high' | 'low' = 'high') => {
    const nearDistance = quality === 'high' ? HIGH_NEAR_DISTANCE : LOW_NEAR_DISTANCE;
    const midDistance = quality === 'high' ? HIGH_MID_DISTANCE : LOW_MID_DISTANCE;
    const cameraLocal = context.local({ x: camera.x, z: camera.z });
    const lodCounts = { near: 0, mid: 0, far: 0 };
    for (const cell of cellBatches) {
      const distanceT = Math.max(cell.bounds.tMin - cameraLocal.t, 0, cameraLocal.t - cell.bounds.tMax);
      const distanceS = Math.max(cell.bounds.sMin - cameraLocal.s, 0, cameraLocal.s - cell.bounds.sMax);
      const distanceToCell = Math.hypot(distanceT, distanceS);
      const lod: CrownLod = distanceToCell <= nearDistance ? 'near' : distanceToCell <= midDistance ? 'mid' : 'far';
      lodCounts[lod]++;
      const activeLod: ActiveCrownLod = lod === 'near' && quality === 'low' ? 'near-low' : lod;
      if (activeLod !== cell.crownLod) {
        cell.crown.geometry = activeLod === 'near-low' ? lowNearGeometry : crownGeometries.get(lod)!;
        // Three.js caches InstancedMesh bounds; invalidate them when the shared crown shape changes.
        cell.crown.boundingBox = null;
        cell.crown.boundingSphere = null;
        cell.crownLod = activeLod;
      }
    }
    stats.lodCells.near = lodCounts.near;
    stats.lodCells.mid = lodCounts.mid;
    stats.lodCells.far = lodCounts.far;
    // Small ground cover is the first detail tier removed on mobile; solid trunks and crowns stay.
    understory.visible = quality === 'high';
  };

  return {
    treeColliders: colliders,
    stats,
    update,
    dispose() {
      for (const cell of cellBatches) {
        scene.remove(cell.trunk, cell.crown);
        if (cell.fronds) scene.remove(cell.fronds);
        cell.trunk.dispose();
        cell.crown.dispose();
        cell.fronds?.dispose();
      }
      if (deadBranches) {
        scene.remove(deadBranches);
        deadBranches.dispose();
      }
      scene.remove(understory, reeds);
      understory.dispose();
      reeds.dispose();
      trunkGeometry.dispose();
      deadBranchGeometry.dispose();
      frondGeometry.dispose();
      understoryGeometry.dispose();
      reedGeometry.dispose();
      for (const geometry of crownGeometries.values()) geometry.dispose();
      lowNearGeometry.dispose();
      foliageAtlas.foliage.dispose();
      foliageAtlas.bark.dispose();
      foliageMaterial.dispose();
      barkMaterial.dispose();
      deadBranchMaterial.dispose();
      palmMaterial.dispose();
      understoryMaterial.dispose();
      reedMaterial.dispose();
    },
  };
}
