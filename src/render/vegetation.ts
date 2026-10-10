import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import type { TreeCollider } from '../sim/collision';

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
  /** Reduced visuals keep every plant but use simpler species-specific crown geometry. */
  visualTier?: VegetationVisualTier;
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
  understory: number;
  reeds: number;
  visualTier: VegetationVisualTier;
};

export type VegetationResult = {
  /** One entry per visible solid woody trunk in either detail tier. */
  treeColliders: TreeCollider[];
  stats: VegetationStats;
  dispose(): void;
};

type Species = 'broadleaf' | 'emergent' | 'secondary' | 'swamp' | 'coastal' | 'palm';
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
};

const TAU = Math.PI * 2;
const PLANT_TARGET = 20_000;
const UNDERSTORY_TARGET = 5_600;
const REED_TARGET = 1_100;
const distance = (a: VegetationPoint, b: VegetationPoint) => Math.hypot(a.x - b.x, a.z - b.z);

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function distanceToLeg(point: VegetationPoint, [start, end]: readonly [VegetationPoint, VegetationPoint]) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.z - start.z - t * dz);
}

function makeCrown(species: Species, reduced = false): THREE.BufferGeometry {
  if (reduced) {
    const profiles: Record<Species, [number, number, number, number]> = {
      broadleaf: [.94, .7, .9, 0],
      emergent: [.98, .76, .94, .04],
      secondary: [.7, 1.02, .73, .12],
      swamp: [1.02, .48, .9, -.03],
      coastal: [1.08, .43, .96, -.1],
      palm: [.62, .38, .62, -.04],
    };
    const [width, height, depth, crownOffset] = profiles[species];
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const positions = geometry.getAttribute('position');
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const taper = species === 'secondary' ? 1 - Math.max(0, y) * .2 : 1;
      const crownY = y * height + crownOffset;
      positions.setXYZ(i, x * width * taper, crownY, z * depth * taper);
      const shade = .88 + Math.max(-.08, y * .07);
      colors.push(shade, shade * 1.015, shade * .95);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  const lumps: THREE.BufferGeometry[] = [];
  const addLump = (position: [number, number, number], scale: [number, number, number]) => {
    const lump = new THREE.DodecahedronGeometry(1, 0);
    lump.scale(...scale);
    lump.translate(...position);
    lumps.push(lump);
  };
  if (species === 'emergent') {
    addLump([0, 0, 0], [.79, .76, .78]);
    addLump([-.5, -.12, .12], [.48, .46, .48]);
    addLump([.49, -.08, -.1], [.47, .5, .46]);
    addLump([.04, .43, -.13], [.42, .4, .42]);
  } else if (species === 'secondary') {
    addLump([0, 0, 0], [.66, .86, .66]);
    addLump([-.36, -.25, .14], [.4, .54, .4]);
    addLump([.37, -.17, -.1], [.39, .57, .4]);
  } else if (species === 'swamp') {
    addLump([0, 0, 0], [.82, .57, .76]);
    addLump([-.46, .1, .08], [.5, .4, .49]);
    addLump([.49, .12, -.1], [.48, .4, .48]);
    addLump([0, .24, .4], [.45, .4, .44]);
  } else if (species === 'coastal') {
    addLump([0, 0, 0], [.78, .59, .72]);
    addLump([-.45, -.12, .08], [.5, .45, .48]);
    addLump([.45, -.07, -.12], [.48, .47, .48]);
  } else {
    addLump([0, 0, 0], [.79, .62, .76]);
    addLump([-.43, -.12, .12], [.48, .48, .48]);
    addLump([.45, -.1, -.1], [.47, .46, .48]);
    addLump([0, .3, -.05], [.49, .44, .5]);
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (let lumpIndex = 0; lumpIndex < lumps.length; lumpIndex++) {
    const lump = lumps[lumpIndex];
    lump.computeVertexNormals();
    const position = lump.getAttribute('position');
    const normal = lump.getAttribute('normal');
    const tint = .88 + lumpIndex * .035;
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      colors.push(tint, tint * 1.015, tint * .95);
    }
    const lumpIndices = lump.getIndex();
    if (lumpIndices) {
      for (let i = 0; i < lumpIndices.count; i++) indices.push(offset + lumpIndices.getX(i));
    } else {
      for (let i = 0; i < position.count; i++) indices.push(offset + i);
    }
    offset += position.count;
    lump.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  result.setIndex(indices);
  return result;
}

/** One bent, low-poly bole and three branch forks, scaled per plant. */
function makeTrunk(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(.12, .25, 1, 5, 1, false);
  trunk.translate(0, .5, 0);
  const pieces: THREE.BufferGeometry[] = [trunk];
  for (let branch = 0; branch < 3; branch++) {
    const angle = branch * TAU / 3 + .3;
    const start = new THREE.Vector3(0, .57, 0);
    const end = new THREE.Vector3(Math.cos(angle) * 1.1, .91, Math.sin(angle) * 1.1);
    const delta = end.clone().sub(start);
    const fork = new THREE.CylinderGeometry(.02, .075, delta.length(), 4, 1, false);
    fork.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
    fork.translate(...start.add(end).multiplyScalar(.5).toArray());
    pieces.push(fork);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const piece of pieces) {
    const attribute = piece.getAttribute('position');
    for (let i = 0; i < attribute.count; i++) positions.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
    const index = piece.getIndex();
    if (index) for (let i = 0; i < index.count; i++) indices.push(offset + index.getX(i));
    else for (let i = 0; i < attribute.count; i++) indices.push(offset + i);
    offset += attribute.count;
    piece.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
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

function makePlantField(campaign: Campaign, mission: Mission, context: VegetationContext) {
  const seed = campaign.id === 'jp_ketapang_2026_09' ? 62017 : 62135;
  const rng = seeded(seed);
  const plants: Plant[] = [];
  const colliders: TreeCollider[] = [];
  const missionFireZones = campaign.missions.map(item => ({ center: item.fire, radius: item.fire.radius + 46 }));
  const settlementZones = [...context.settlementExclusions, ...context.farmExclusions];
  const coast = context.coastAt(0);
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
    const coastDistance = local.t - context.coastAt(local.s);
    const riverDistance = Math.abs(local.s - context.riverS(local.t));
    if (riverDistance < 52) continue;
    if (inZones(point, settlementZones, 25) || inZones(point, missionFireZones, 0)) continue;
    if (mission.shore && distance(point, mission.shore) < 900) continue;

    let routeDistance = Infinity;
    for (const leg of context.flightLegs) routeDistance = Math.min(routeDistance, distanceToLeg(point, leg));

    // Multi-scale stand structure gives irregular dense pockets instead of a uniform grid.
    const standNoise = Math.sin(t * .0018 + .45) * Math.cos(s * .00155 - .8)
      + .36 * Math.sin((t + s) * .0038) + .17 * Math.cos((t - s) * .0062);
    const canopyNoise = Math.sin(t * .0046 + 1.1) * Math.cos(s * .0039 - .6)
      + .3 * Math.sin((t + s) * .0091);
    const patchProbability = Math.max(.2, Math.min(.92, .56 + standNoise * .24));
    if (rng() > patchProbability) continue;

    const species = chooseSpecies(rng, coastDistance, riverDistance, canopyNoise, t, s);
    const shape = shapeFor(species, rng, routeDistance);
    // Leave room for rotor radius and collision padding around marked flight legs.
    const routeClearance = species === 'emergent' ? 170 + shape.radius : 61 + shape.radius;
    if (routeDistance < routeClearance) continue;
    const yaw = rng() * TAU;
    const trunkScale = species === 'coastal' ? .85 + rng() * .45 : .68 + rng() * .48;
    const bark = new THREE.Color().setHSL(.075 + rng() * .025, .16 + rng() * .08, .20 + rng() * .08).convertSRGBToLinear();
    const leaves = randomLeafColor(rng, shape.species, t, s);
    const plant: Plant = {
      point, ground, height: shape.height, radius: shape.radius, yaw, trunkScale,
      species: shape.species, bark, leaves,
      rootScale: shape.species === 'coastal' || shape.species === 'swamp' ? .58 + rng() * .65 : 0,
    };
    plants.push(plant);
    colliders.push({ x: point.x, z: point.z, ground, height: shape.height, radius: shape.radius });
  }

  return { plants, colliders };
}

/**
 * Creates low-poly, instanced lowland forest. Every rendered trunk and palm receives a
 * collider; reduced visuals simplify each crown while preserving every plant silhouette.
 */
export function createVegetation(
  scene: THREE.Scene,
  campaign: Campaign,
  mission: Mission,
  context: VegetationContext,
): VegetationResult {
  const { plants, colliders } = makePlantField(campaign, mission, context);
  const visualTier = context.visualTier ?? 'full';
  const visible = plants;

  const species: Species[] = ['broadleaf', 'emergent', 'secondary', 'swamp', 'coastal', 'palm'];
  const capacities = new Map<Species, number>(species.map(kind => [kind, visible.reduce((sum, plant) => sum + Number(plant.species === kind), 0)]));
  const geometries = new Map<Species, THREE.BufferGeometry>(species.map(kind => [kind, makeCrown(kind, visualTier === 'reduced')]));
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .98 });
  const barkMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  const palmMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .96, side: THREE.DoubleSide });
  const trunkMesh = new THREE.InstancedMesh(makeTrunk(), barkMaterial, visible.length);
  trunkMesh.name = 'lowland tree boles';
  trunkMesh.castShadow = false;
  trunkMesh.receiveShadow = false;
  const crowns = new Map<Species, THREE.InstancedMesh>();
  for (const kind of species) {
    const mesh = new THREE.InstancedMesh(geometries.get(kind)!, foliageMaterial, capacities.get(kind)!);
    mesh.name = `${kind} canopy`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    crowns.set(kind, mesh);
  }

  const rootCapacity = visible.reduce((sum, plant) => sum + (plant.rootScale > 0 ? 3 : 0), 0);
  const rootsGeometry = new THREE.CylinderGeometry(.018, .13, 1, 4, 1, false);
  const roots = new THREE.InstancedMesh(rootsGeometry, barkMaterial, rootCapacity);
  roots.name = 'coastal and swamp root flares';
  roots.castShadow = false;
  roots.receiveShadow = false;

  const frondGeometry = makePalmFrond();
  const palmCount = capacities.get('palm')!;
  const fronds = new THREE.InstancedMesh(frondGeometry, palmMaterial, palmCount * 7);
  fronds.name = 'palm fronds';
  fronds.castShadow = false;
  fronds.receiveShadow = false;

  const dummy = new THREE.Object3D();
  const fromUp = new THREE.Vector3(0, 1, 0);
  const rootDirection = new THREE.Vector3();
  const rootStart = new THREE.Vector3();
  const rootEnd = new THREE.Vector3();
  const counters = new Map<Species, number>(species.map(kind => [kind, 0]));
  let rootIndex = 0;
  let trunkIndex = 0;
  let frondIndex = 0;

  for (let plantIndex = 0; plantIndex < plants.length; plantIndex++) {
    const plant = plants[plantIndex];
    const { x, z } = plant.point;
    dummy.position.set(x, plant.ground, z);
    dummy.rotation.set(0, plant.yaw, 0);
    dummy.scale.set(plant.trunkScale, plant.height, plant.trunkScale);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(trunkIndex, dummy.matrix);
    trunkMesh.setColorAt(trunkIndex++, plant.bark);

    const crown = crowns.get(plant.species)!;
    const crownIndex = counters.get(plant.species)!;
    dummy.position.set(x, plant.ground + plant.height * .91, z);
    dummy.rotation.set(0, plant.yaw, 0);
    dummy.scale.set(plant.radius, plant.radius * (plant.species === 'secondary' ? .8 : .68), plant.radius);
    dummy.updateMatrix();
    crown.setMatrixAt(crownIndex, dummy.matrix);
    crown.setColorAt(crownIndex, plant.leaves);
    counters.set(plant.species, crownIndex + 1);

    if (plant.rootScale > 0) {
      for (let i = 0; i < 3; i++) {
        const angle = plant.yaw + i * TAU / 3 + .2;
        rootStart.set(x + Math.cos(angle) * .48, plant.ground + plant.height * .24, z + Math.sin(angle) * .48);
        rootEnd.set(x + Math.cos(angle) * plant.rootScale * 2.45, plant.ground + .06, z + Math.sin(angle) * plant.rootScale * 2.45);
        rootDirection.copy(rootEnd).sub(rootStart);
        dummy.position.copy(rootStart).add(rootEnd).multiplyScalar(.5);
        const rootLength = rootDirection.length();
        dummy.quaternion.setFromUnitVectors(fromUp, rootDirection.normalize());
        dummy.scale.set(plant.rootScale, rootLength, plant.rootScale);
        dummy.updateMatrix();
        roots.setMatrixAt(rootIndex, dummy.matrix);
        roots.setColorAt(rootIndex++, plant.bark);
      }
    }

    if (plant.species === 'palm') {
      const top = plant.ground + plant.height;
      for (let frond = 0; frond < 7; frond++) {
        const angle = plant.yaw + frond / 7 * TAU;
        dummy.position.set(x, top, z);
        dummy.quaternion.setFromEuler(new THREE.Euler(.38 + (frond % 2) * .08, angle, (frond % 2 ? -1 : 1) * .12));
        dummy.scale.setScalar(.76 + (frond % 3) * .08);
        dummy.updateMatrix();
        fronds.setMatrixAt(frondIndex++, dummy.matrix);
      }
    }
  }

  trunkMesh.count = trunkIndex;
  roots.count = rootIndex;
  fronds.count = frondIndex;
  trunkMesh.instanceMatrix.needsUpdate = true;
  if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
  roots.instanceMatrix.needsUpdate = true;
  if (roots.instanceColor) roots.instanceColor.needsUpdate = true;
  fronds.instanceMatrix.needsUpdate = true;
  for (const [kind, mesh] of crowns) {
    mesh.count = counters.get(kind)!;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  const understoryGeometry = new THREE.IcosahedronGeometry(1, 0);
  const understoryMaterial = new THREE.MeshStandardMaterial({ color: '#68794b', roughness: 1 });
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
  const settlementZones = [...context.settlementExclusions, ...context.farmExclusions];
  const missionFireZones = campaign.missions.map(item => ({ center: item.fire, radius: item.fire.radius + 46 }));
  let understoryCount = 0;
  let understoryTries = 0;
  while (understoryCount < UNDERSTORY_TARGET && understoryTries++ < UNDERSTORY_TARGET * 8) {
    const t = context.coastAt(0) + 90 + rng() * 3_000;
    const s = (rng() - .5) * 5_600;
    const point = context.fromLocal(t, s);
    if (context.isLake(point) || context.terrainHeight(point.x, point.z) < -4) continue;
    if (inZones(point, settlementZones, 20) || inZones(point, missionFireZones, 0)) continue;
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
    understory.setColorAt(understoryCount++, randomLeafColor(rng, 'secondary', t, s));
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

  scene.add(trunkMesh, roots, fronds, understory, reeds, ...crowns.values());

  const totals: Record<Species, number> = {
    broadleaf: 0, emergent: 0, secondary: 0, swamp: 0, coastal: 0, palm: 0,
  };
  for (const plant of plants) totals[plant.species]++;
  const stats: VegetationStats = {
    woodyPlants: plants.length,
    visiblePlants: trunkIndex,
    broadleaf: totals.broadleaf,
    emergent: totals.emergent,
    secondary: totals.secondary,
    swamp: totals.swamp,
    coastal: totals.coastal,
    palms: totals.palm,
    understory: understoryCount,
    reeds: reedCount,
    visualTier,
  };

  return {
    treeColliders: colliders,
    stats,
    dispose() {
      scene.remove(trunkMesh, roots, fronds, understory, reeds, ...crowns.values());
      trunkMesh.geometry.dispose();
      rootsGeometry.dispose();
      frondGeometry.dispose();
      understoryGeometry.dispose();
      reedGeometry.dispose();
      for (const geometry of geometries.values()) geometry.dispose();
      foliageMaterial.dispose();
      barkMaterial.dispose();
      palmMaterial.dispose();
      understoryMaterial.dispose();
      reedMaterial.dispose();
    },
  };
}
