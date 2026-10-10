import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Campaign, Mission } from '../types';
import type { StructureCollider, TreeCollider } from '../sim/collision';
import { renderedTerrainHeight } from '../sim/collision';
import { SEA_SURFACE_Y, type CoastalSampler } from './coastalSampling';

type Point = { x: number; z: number };
type Leg = [Point, Point];

export interface CoastalDetailsResult {
  treeColliders: TreeCollider[];
  structureColliders: StructureCollider[];
  boats: THREE.Group;
  lightingAnchor?: { x: number; y: number; z: number };
  stats: { coastalDrawCalls: number; coastalTriangles: number; boatCount: number; mangroveCount: number; mangrovePocketCount: number; grassCount: number; footpathSegments: number; coastalYardCount: number };
  update(time: number, nightStrength?: number): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const distanceToLeg = (p: Point, [a, b]: Leg) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const denom = dx * dx + dz * dz;
  const t = denom ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / denom)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const seeded = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

function addBox(parts: THREE.BufferGeometry[], size: [number, number, number], position: [number, number, number], hex: string, rotationZ = 0) {
  const geometry = new THREE.BoxGeometry(...size);
  if (rotationZ) geometry.rotateZ(rotationZ);
  geometry.translate(...position);
  const color = new THREE.Color(hex);
  const colors: number[] = [];
  for (let i = 0; i < geometry.getAttribute('position').count; i++) colors.push(color.r, color.g, color.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  parts.push(geometry);
}

function addCylinder(parts: THREE.BufferGeometry[], radius: number, height: number, position: [number, number, number], hex: string) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 8, 1, false);
  geometry.translate(...position);
  const color = new THREE.Color(hex), colors: number[] = [];
  for (let i = 0; i < geometry.getAttribute('position').count; i++) colors.push(color.r, color.g, color.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  parts.push(geometry);
}

function addGableEnd(parts: THREE.BufferGeometry[], width: number, wallHeight: number, rise: number, z: number, hex: string) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -width * .5, wallHeight, z, width * .5, wallHeight, z, 0, wallHeight + rise, z,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  const color = new THREE.Color(hex);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([...Array(3)].flatMap(() => [color.r, color.g, color.b]), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2));
  geometry.computeVertexNormals();
  parts.push(geometry);
}

function merge(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts, true)!;
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

function colliderFor(object: THREE.Object3D, label: string): StructureCollider {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object);
  return {
    x: (bounds.min.x + bounds.max.x) * .5,
    z: (bounds.min.z + bounds.max.z) * .5,
    halfWidth: (bounds.max.x - bounds.min.x) * .5,
    halfLength: (bounds.max.z - bounds.min.z) * .5,
    bottom: bounds.min.y,
    top: bounds.max.y,
    label,
  };
}

function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.4;
    const width = .06 + (i % 2) * .025;
    const height = .65 + (i % 3) * .16;
    const x = Math.cos(angle) * .12, z = Math.sin(angle) * .12;
    const sideX = Math.cos(angle + Math.PI / 2) * width;
    const sideZ = Math.sin(angle + Math.PI / 2) * width;
    positions.push(x - sideX, 0, z - sideZ, x + sideX, 0, z + sideZ, x + Math.cos(angle) * .12, height, z + Math.sin(angle) * .12);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mangroveGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(.16, .28, 2.7, 5, 1, false); stem.translate(0, 1.35, 0); parts.push(stem);
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + .2;
    const start = new THREE.Vector3(0, .65, 0);
    const end = new THREE.Vector3(Math.cos(a) * 1.45, .08, Math.sin(a) * 1.45);
    const delta = end.clone().sub(start);
    const root = new THREE.CylinderGeometry(.035, .12, delta.length(), 4, 1, false);
    root.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()));
    root.translate(...start.add(end).multiplyScalar(.5).toArray());
    parts.push(root);
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return geometry;
}

function boatGeometry(length: number, width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -length * .5);
  shape.lineTo(width * .42, -length * .5 + 1.2);
  shape.lineTo(width * .5, length * .5 - .8);
  shape.lineTo(width * .28, length * .5);
  shape.lineTo(-width * .28, length * .5);
  shape.lineTo(-width * .5, length * .5 - .8);
  shape.lineTo(-width * .42, -length * .5 + 1.2);
  shape.closePath();
  const hull = new THREE.ExtrudeGeometry(shape, { depth: .5, bevelEnabled: false, steps: 1 });
  hull.rotateX(Math.PI / 2);
  hull.translate(0, .1, 0);
  const cabin = new THREE.BoxGeometry(width * .56, .62, length * .31);
  cabin.translate(0, .41, length * .05);
  const canopy = new THREE.BoxGeometry(width * .44, .08, length * .2);
  canopy.translate(0, .76, length * .05);
  // ExtrudeGeometry is non-indexed in Three.js while the box primitives are indexed.
  // Normalize all three before merging so boat instances get a valid shared vertex buffer.
  const parts = [hull, cabin, canopy].map(geometry => geometry.index ? geometry.toNonIndexed() : geometry);
  const merged = mergeGeometries(parts)!;
  parts.forEach(geometry => geometry.dispose());
  [hull, cabin, canopy].forEach(geometry => { if (!parts.includes(geometry)) geometry.dispose(); });
  return merged;
}

/** Small, deterministic shoreline props. Coastal randomness uses a private seed so adding them
 * never rearranges the existing forest, lake reeds, or settlement. */
export function createCoastalDetails(
  scene: THREE.Scene,
  campaign: Campaign,
  mission: Mission,
  sampler: CoastalSampler,
  flightLegs: readonly Leg[],
): CoastalDetailsResult {
  const jp = campaign.id === 'jp_ketapang_2026_09';
  const random = seeded(jp ? 0x4a50434f : 0x52534143);
  const root = new THREE.Group();
  root.name = 'Coastal details';
  const treeColliders: TreeCollider[] = [];
  const structureColliders: StructureCollider[] = [];
  const coastGround = (t: number, s: number) => {
    const p = sampler.fromLocal(t, s);
    return { ...p, ground: renderedTerrainHeight(campaign, mission, p.x, p.z) };
  };
  const routeClearance = (p: Point) => Math.min(...flightLegs.map(leg => distanceToLeg(p, leg)));
  const isProtected = (p: Point, margin = 150) => campaign.missions.some(m =>
    distance(p, m.lake) < m.lake.radius + margin || distance(p, m.fire) < m.fire.radius + margin) ||
    (mission.shore !== undefined && distance(p, mission.shore) < 900 + margin) || distance(p, mission.ship) < 480;
  const safePoint = (p: Point, routeMargin: number) => routeClearance(p) > routeMargin && !isProtected(p);
  const coastalCandidateS = [-520, 620, -1150, 1350, -1750, 1950, -2350, 2650, -3050, 3350, -3650, 3950, -4300, 4300];
  const safeStructureS = coastalCandidateS.filter(s => {
    const p = sampler.fromLocal(sampler.coastAt(s) + 47, s);
    return safePoint(p, 420) && Math.abs(s + 850) > 240;
  });
  const safeBoatS = coastalCandidateS.filter(s => {
    const p = sampler.fromLocal(sampler.coastAt(s) - 110, s);
    return safePoint(p, 260) && Math.abs(s + 850) > 180 && distance(p, mission.lake) > mission.lake.radius + 300;
  });

  // Narrow wet-sand / mud fringe. Each vertex uses the visible mesh's interpolated height.
  const beachParts = [
    { d: .65, color: '#656652' }, { d: 2.8, color: '#77705a' },
    { d: 6.5, color: '#918269' }, { d: 13, color: '#a79a76' },
    { d: 23, color: '#817f5e' }, { d: 37, color: '#5e704e' },
  ];
  const beachPos: number[] = [], beachColor: number[] = [], beachUv: number[] = [], beachIndex: number[] = [];
  const beachRows = 360;
  for (let row = 0; row <= beachRows; row++) {
    const s = -4440 + row / beachRows * 8880;
    for (let col = 0; col < beachParts.length; col++) {
      const band = beachParts[col], p = coastGround(sampler.coastAt(s) + band.d, s);
      const c = new THREE.Color(band.color); c.offsetHSL(0, 0, (random() - .5) * .025);
      beachPos.push(p.x, (p.ground ?? SEA_SURFACE_Y) + .018, p.z);
      beachColor.push(c.r, c.g, c.b); beachUv.push(row / beachRows, col / (beachParts.length - 1));
      if (row < beachRows && col < beachParts.length - 1) {
        const a = row * beachParts.length + col, b = a + beachParts.length;
        beachIndex.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const beachGeometry = new THREE.BufferGeometry();
  beachGeometry.setAttribute('position', new THREE.Float32BufferAttribute(beachPos, 3));
  beachGeometry.setAttribute('color', new THREE.Float32BufferAttribute(beachColor, 3));
  beachGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(beachUv, 2));
  beachGeometry.setIndex(beachIndex); beachGeometry.computeVertexNormals();
  const beach = new THREE.Mesh(beachGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  beach.name = 'Wet sand and mud fringe'; beach.receiveShadow = true; root.add(beach);

  // Subtle, shallow water ribbon over the sea plane. It follows the same coast curve and has no
  // collision or terrain effect; the water renderer can reinforce its color through its shader.
  const shelfPos: number[] = [], shelfColor: number[] = [], shelfIndex: number[] = [];
  const shelfRows = 300, shelfCols = 5;
  const shelfOffsets = [-72, -54, -36, -18, 0];
  const shelfTints = ['#315c64', '#3f6d70', '#527d7c', '#6c8b83', '#87968a'].map(color => new THREE.Color(color));
  for (let row = 0; row <= shelfRows; row++) {
    const s = -4400 + row / shelfRows * 8800;
    for (let col = 0; col < shelfCols; col++) {
      const p = sampler.fromLocal(sampler.coastAt(s) + shelfOffsets[col], s);
      const depth = .1 - shelfOffsets[col] / 72 * 2.9;
      shelfPos.push(p.x, SEA_SURFACE_Y - depth, p.z);
      const c = shelfTints[col]; shelfColor.push(c.r, c.g, c.b);
      if (row < shelfRows && col < shelfCols - 1) {
        const a = row * shelfCols + col, b = a + shelfCols;
        shelfIndex.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const shelfGeometry = new THREE.BufferGeometry();
  shelfGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shelfPos, 3));
  shelfGeometry.setAttribute('color', new THREE.Float32BufferAttribute(shelfColor, 3));
  shelfGeometry.setIndex(shelfIndex); shelfGeometry.computeVertexNormals();
  const shelf = new THREE.Mesh(shelfGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, depthWrite: true, roughness: 1 }));
  shelf.name = 'Coastal shallow shelf'; shelf.renderOrder = -1; root.add(shelf);

  // Seagrass and salt-tolerant low plants grow in small, broken clusters above the tidal edge.
  const grassGeometry = tuftGeometry();
  const grassMeshes = [
    new THREE.InstancedMesh(grassGeometry, new THREE.MeshStandardMaterial({ color: '#718353', roughness: 1, side: THREE.DoubleSide }), 1050),
    new THREE.InstancedMesh(grassGeometry.clone(), new THREE.MeshStandardMaterial({ color: '#9a8e63', roughness: 1, side: THREE.DoubleSide }), 650),
  ];
  grassMeshes.forEach(mesh => { mesh.castShadow = false; mesh.receiveShadow = true; root.add(mesh); });
  const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
  const shrubs = new THREE.InstancedMesh(shrubGeometry, new THREE.MeshStandardMaterial({ color: '#5e704b', roughness: 1 }), 260);
  shrubs.castShadow = true; shrubs.receiveShadow = true; root.add(shrubs);
  const mangroveGeometryData = mangroveGeometry();
  const mangroves = new THREE.InstancedMesh(mangroveGeometryData, new THREE.MeshStandardMaterial({ color: '#625844', roughness: 1 }), 150);
  const mangroveCrowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#596c45', roughness: 1 }), 150);
  mangroves.castShadow = true; mangroves.receiveShadow = true; mangroveCrowns.castShadow = true; mangroveCrowns.receiveShadow = true;
  root.add(mangroves, mangroveCrowns);
  const dummy = new THREE.Object3D();
  const grassCounts = [0, 0], grassTotal = 1700;
  let shrubCount = 0, mangroveCount = 0;
  const plantSpot = (p: Point) => {
    const sample = sampler.sample(p.x, p.z);
    if (!sample.isLand || sample.shoreDistance < 3 || sample.shoreDistance > 190) return null;
    const ground = renderedTerrainHeight(campaign, mission, p.x, p.z);
    if (ground === null || !safePoint(p, 125)) return null;
    if (Math.abs(sample.s + 850 - 120 * Math.sin(sample.t * .0021) - 75 * Math.sin(sample.t * .0053)) < 95) return null;
    return { sample, ground };
  };
  // Eight-patch clusters create clear gaps along the strand and keep the flight line readable.
  for (let patch = 0; patch < 190; patch++) {
    const centerS = -4050 + random() * 8100;
    const centerD = 14 + random() * 170;
    const centerT = sampler.coastAt(centerS) + centerD;
    const count = 5 + Math.floor(random() * 5);
    for (let k = 0; k < count; k++) {
      const s = centerS + (random() - .5) * 60;
      const t = centerT + (random() - .5) * 22;
      const p = sampler.fromLocal(t, s), placement = plantSpot(p);
      if (!placement || grassCounts[0] + grassCounts[1] >= grassTotal) continue;
      let variant = placement.sample.shoreDistance > 95 && random() < .38 ? 1 : 0;
      if (grassCounts[variant] >= grassMeshes[variant].instanceMatrix.count) variant = 1 - variant;
      if (grassCounts[variant] >= grassMeshes[variant].instanceMatrix.count) continue;
      const index = grassCounts[variant]++;
      dummy.position.set(p.x, placement.ground, p.z);
      const scale = .7 + random() * .8;
      dummy.scale.set(scale, scale, scale); dummy.rotation.set(0, random() * TAU, 0); dummy.updateMatrix();
      grassMeshes[variant].setMatrixAt(index, dummy.matrix);
    }
  }
  grassMeshes.forEach((mesh, i) => { mesh.count = grassCounts[i]; mesh.instanceMatrix.needsUpdate = true; });

  // Short coastal-root trees form irregular stands with open breaks between them. Each tree is
  // still checked against route and objective buffers, and its collider follows the instance.
  let mangrovePocketCount = 0;
  for (let pocket = 0; pocket < 34 && mangroveCount < 130; pocket++) {
    const centerS = -4050 + random() * 8100;
    const centerD = 24 + random() * 138;
    const center = sampler.fromLocal(sampler.coastAt(centerS) + centerD, centerS);
    if (!safePoint(center, 235) || routeClearance(center) < 235 || isProtected(center, 250)) continue;
    let pocketTrees = 0;
    const wanted = 4 + Math.floor(random() * 6);
    for (let member = 0; member < wanted && mangroveCount < 130; member++) {
      const s = centerS + (random() - .5) * 72;
      const t = sampler.coastAt(s) + centerD + (random() - .5) * 34;
      const p = sampler.fromLocal(t, s), placement = plantSpot(p);
      if (!placement || routeClearance(p) < 185 || isProtected(p, 250)) continue;
      const height = 3.2 + random() * 1.6, radius = 2.3 + random() * .6, yaw = random() * TAU;
      dummy.position.set(p.x, placement.ground, p.z); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(.85 + random() * .3); dummy.updateMatrix();
      mangroves.setMatrixAt(mangroveCount, dummy.matrix);
      dummy.position.set(p.x, placement.ground + height, p.z); dummy.scale.set(radius * 1.4, height * .42, radius * 1.4); dummy.rotation.set(0, yaw, 0); dummy.updateMatrix();
      mangroveCrowns.setMatrixAt(mangroveCount, dummy.matrix);
      mangroves.setColorAt(mangroveCount, new THREE.Color().setHSL(.09, .16, .23 + random() * .05).convertSRGBToLinear());
      mangroveCrowns.setColorAt(mangroveCount, new THREE.Color().setHSL(.26 + random() * .035, .31, .22 + random() * .06).convertSRGBToLinear());
      treeColliders.push({ x: p.x, z: p.z, ground: placement.ground, height: height + 2.3, radius: radius * 1.4 });
      mangroveCount++;
      pocketTrees++;
    }
    if (pocketTrees >= 3) mangrovePocketCount++;
  }
  mangroves.count = mangroveCount; mangroveCrowns.count = mangroveCount;
  mangroves.instanceMatrix.needsUpdate = true; mangroveCrowns.instanceMatrix.needsUpdate = true;

  for (let patch = 0; patch < 78 && shrubCount < 210; patch++) {
    const centerS = -4050 + random() * 8100, centerT = sampler.coastAt(centerS) + 18 + random() * 145;
    const count = 2 + Math.floor(random() * 5);
    for (let member = 0; member < count && shrubCount < 210; member++) {
      const s = centerS + (random() - .5) * 34, t = centerT + (random() - .5) * 28;
      const p = sampler.fromLocal(t, s), placement = plantSpot(p);
      if (!placement) continue;
      dummy.position.set(p.x, placement.ground + .42, p.z);
      dummy.scale.set(1.2 + random() * 1.2, .55 + random() * .45, 1.2 + random() * 1.2);
      dummy.rotation.set(0, random() * TAU, 0); dummy.updateMatrix(); shrubs.setMatrixAt(shrubCount++, dummy.matrix);
    }
  }
  shrubs.count = shrubCount; shrubs.instanceMatrix.needsUpdate = true;

  // Eight boats total: three freshwater skiffs and five moored along the wider coast.
  const boatSpecs = [
    { length: 7, width: 1.55, color: '#75674e' },
    { length: 9, width: 1.9, color: '#667263' },
    { length: 11, width: 2.2, color: '#80624b' },
  ];
  const boats = new THREE.Group(); boats.name = 'Coastal boat fleet';
  const boatMeshes = boatSpecs.map(spec => {
    const mesh = new THREE.InstancedMesh(boatGeometry(spec.length, spec.width), new THREE.MeshStandardMaterial({ color: spec.color, roughness: .9 }), 8);
    mesh.castShadow = true; mesh.receiveShadow = true; boats.add(mesh); return mesh;
  });
  const boatRecords: Array<{ variant: number; index: number; x: number; z: number; baseY: number; yaw: number; phase: number; amplitude: number }> = [];
  const boatCounts = [0, 0, 0];
  const placeBoat = (t: number, s: number, variant: number, baseY: number, yaw: number, phase: number) => {
    const p = sampler.fromLocal(t, s), index = boatCounts[variant]++;
    boatRecords.push({ variant, index, x: p.x, z: p.z, baseY, yaw, phase, amplitude: .045 + variant * .009 });
    const cos = Math.abs(Math.cos(yaw)), sin = Math.abs(Math.sin(yaw));
    const halfWidth = (boatSpecs[variant].width * cos + boatSpecs[variant].length * sin) * .52;
    const halfLength = (boatSpecs[variant].length * cos + boatSpecs[variant].width * sin) * .52;
    structureColliders.push({ x: p.x, z: p.z, halfWidth, halfLength, bottom: baseY - .45, top: baseY + .77, label: 'coastal working boat' });
  };
  const lakeTarget = mission.lake;
  const lakeLocal = sampler.toLocal(lakeTarget.x, lakeTarget.z);
  for (let i = 0; i < 3; i++) placeBoat(lakeLocal.x + (i - 1) * 19, lakeLocal.z + mission.lake.radius * .76, i, .04, Math.atan2(sampler.fromLocal(1, 0).x - mission.ship.x, sampler.fromLocal(1, 0).z - mission.ship.z) + .3, i * 2);
  let seaBoatCount = 0;
  for (const s of safeBoatS) {
    if (seaBoatCount >= 5) break;
    const t = sampler.coastAt(s) - 75 - (seaBoatCount % 2) * 44;
    const p = sampler.fromLocal(t, s);
    if (!safePoint(p, 260) || distance(p, mission.lake) < mission.lake.radius + 300) continue;
    const tVector = sampler.fromLocal(1, 0);
    const yaw = Math.atan2(tVector.x - mission.ship.x, tVector.z - mission.ship.z) + (random() - .5) * .28;
    placeBoat(t, s, (seaBoatCount + 1) % 3, SEA_SURFACE_Y + .18, yaw, random() * TAU);
    seaBoatCount++;
  }
  boatMeshes.forEach((mesh, i) => { mesh.count = boatCounts[i]; mesh.instanceMatrix.needsUpdate = true; });
  root.add(boats);

  // One raised fishing hut and a short, stepped jetty are omitted if a campaign route or
  // protected objective occupies every candidate cove.
  let structureAnchor: { s: number; t: number; x: number; z: number } | undefined;
  for (const s of safeStructureS) {
    const t = sampler.coastAt(s) + 47, p = sampler.fromLocal(t, s);
    if (safePoint(p, 420)) { structureAnchor = { s, t, ...p }; break; }
  }
  let lampMesh: THREE.Mesh | undefined;
  let lampMaterial: THREE.MeshStandardMaterial | undefined;
  let lightingAnchor: { x: number; y: number; z: number } | undefined;
  let footpathSegments = 0;
  let coastalYardCount = 0;
  if (structureAnchor) {
    const { s } = structureAnchor;
    const parts: THREE.BufferGeometry[] = [];
    const jettySections = [-95, -70, -45, -20, 5, 30];
    for (const d of jettySections) {
      const centerT = sampler.coastAt(s) + d;
      const at = coastGround(centerT, s);
      const terrain = at.ground ?? SEA_SURFACE_Y - 1.5;
      const deckY = Math.max(SEA_SURFACE_Y + 1.15, terrain + .72);
      addBox(parts, [6, .2, 24], [0, deckY, d - 47], '#776548');
      for (const side of [-1, 1]) {
        const bottom = Math.min(terrain, SEA_SURFACE_Y - 1.2);
        const postHeight = Math.max(.5, deckY - bottom + .4);
        addBox(parts, [.28, postHeight, .28], [side * 2.45, bottom + postHeight * .5, d - 47], '#594c3a');
        addBox(parts, [.12, .13, 25], [side * 2.9, deckY + .75, d - 47], '#715d43');
      }
    }
    // Stilts lift the small hut above the uneven strand; all supports start at the visible mesh.
    const hutT = sampler.coastAt(s) + 47, hut = coastGround(hutT, s);
    const ground = hut.ground ?? SEA_SURFACE_Y;
    const floor = ground + 3.2;
    for (const x of [-3, 3]) for (const z of [-3, 3]) {
      const height = floor - ground;
      addBox(parts, [.34, height, .34], [x, ground + height * .5, z], '#574a38');
    }
    addBox(parts, [8, .24, 8], [0, floor, 0], '#79694e');
    addBox(parts, [7.1, 2.8, 6.8], [0, floor + 1.52, 0], '#aa9b7d');
    addBox(parts, [5.5, .24, 9.2], [-2.15, floor + 3.5, 0], '#6b7165', .48);
    addBox(parts, [5.5, .24, 9.2], [2.15, floor + 3.5, 0], '#6b7165', -.48);
    addGableEnd(parts, 7.1, floor + 2.92, 1.2, -3.42, '#777d70');
    addGableEnd(parts, 7.1, floor + 2.92, 1.2, 3.42, '#777d70');
    for (const side of [-1, 1]) addBox(parts, [.18, 2.5, .18], [side * 4.25, floor + 1.25, -16], '#594c3a');

    // Two nearby work shelters keep the jetty hut legible as a small working cove.
    const addWorkShelter = (centerX: number, centerZ: number, width: number, depth: number, lift: number, wallHeight: number, open: boolean) => {
      const localT = hutT + centerZ, localS = s - centerX;
      const shelterGround = coastGround(localT, localS).ground ?? SEA_SURFACE_Y;
      const shelterFloor = shelterGround + lift;
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
        addBox(parts, [.26, lift, .26], [centerX + sideX * (width * .39), shelterGround + lift * .5, centerZ + sideZ * (depth * .39)], '#594c3a');
      }
      addBox(parts, [width, .2, depth], [centerX, shelterFloor, centerZ], '#78684d');
      if (!open) addBox(parts, [width - .5, wallHeight, depth - .5], [centerX, shelterFloor + wallHeight * .5 + .12, centerZ], '#968d75');
      const roofCenterY = shelterFloor + wallHeight + .55;
      addBox(parts, [width * .62, .18, depth + .6], [centerX - width * .23, roofCenterY, centerZ], '#74796d', .52);
      addBox(parts, [width * .62, .18, depth + .6], [centerX + width * .23, roofCenterY, centerZ], '#74796d', -.52);
    };
    const shelterOne = coastGround(hutT + 5, s + 16);
    const shelterTwo = coastGround(hutT + 11, s - 17);
    if (shelterOne.ground !== null && shelterTwo.ground !== null) {
      addWorkShelter(-16, 5, 7.2, 7, 2.5, 1.5, true);
      addWorkShelter(17, 11, 6.2, 7.5, 2, 2.2, false);
      // Crates, water drums, rope coils and a covered tool box share the merged prop draw.
      addBox(parts, [1.3, .9, 1.1], [19.5, shelterTwo.ground + 2.45, 13.4], '#a77945');
      addBox(parts, [1.2, .8, 1.1], [21, shelterTwo.ground + 2.4, 11.5], '#596b60');
      addBox(parts, [1.5, .7, 1.2], [-20, shelterOne.ground + 1.05, 10], '#9d895c');
      addCylinder(parts, .7, 1.55, [20, shelterTwo.ground + .78, 5], '#64776b');
      addCylinder(parts, .48, 1.2, [22, shelterTwo.ground + .6, 6.8], '#7b765d');
      addBox(parts, [2.1, .22, .45], [17, shelterTwo.ground + 1.15, 8.6], '#776347');
    }
    // Lantern standards are part of the merged pier structure; only their warm bulbs emit.
    const lampD = -10;
    const lampGround = coastGround(sampler.coastAt(s) + lampD, s).ground ?? SEA_SURFACE_Y;
    const lampDeck = Math.max(SEA_SURFACE_Y + 1.15, lampGround + .72);
    for (const x of [-3.2, 3.2]) addBox(parts, [.18, 2.1, .18], [x, lampDeck + 1.05, lampD - 47], '#584a36');

    // Preserve a tight collision box for the hut and pier before adding the inland yard to the
    // same merged draw call. The path is ground-level dressing; the shed and fence get their own
    // world-aligned structure bounds below.
    const hutOnlyGeometry = merge(parts.map(part => part.clone()));
    const hutOnlyMesh = new THREE.Mesh(hutOnlyGeometry);
    hutOnlyMesh.position.set(structureAnchor.x, 0, structureAnchor.z);
    const tAxis = sampler.fromLocal(1, 0);
    const structureYaw = Math.atan2(tAxis.x - mission.ship.x, tAxis.z - mission.ship.z);
    hutOnlyMesh.rotation.y = structureYaw;
    structureColliders.push(colliderFor(hutOnlyMesh, 'coastal stilt hut and jetty'));
    hutOnlyGeometry.dispose();

    const localPoint = (x: number, z: number) => sampler.fromLocal(hutT + z, s - x);
    const localGround = (x: number, z: number) => coastGround(hutT + z, s - x).ground;
    const footprintIsSafe = (x: number, z: number, halfX: number, halfZ: number) =>
      [[x, z], [x - halfX, z - halfZ], [x - halfX, z + halfZ], [x + halfX, z - halfZ], [x + halfX, z + halfZ]]
        .every(([localX, localZ]) => {
          const point = localPoint(localX, localZ);
          return safePoint(point, 470) && routeClearance(point) > 470;
        });
    const localCollider = (x: number, z: number, halfX: number, halfZ: number, bottom: number, top: number, label: string): StructureCollider => {
      const center = localPoint(x, z), xAxis = localPoint(x + 1, z), zAxis = localPoint(x, z + 1);
      return {
        x: center.x,
        z: center.z,
        halfWidth: Math.abs(xAxis.x - center.x) * halfX + Math.abs(zAxis.x - center.x) * halfZ,
        halfLength: Math.abs(xAxis.z - center.z) * halfX + Math.abs(zAxis.z - center.z) * halfZ,
        bottom,
        top,
        label,
      };
    };

    // A thin packed-earth track leaves the hut for a little inland work yard. Sample each section
    // from the rendered terrain and break the line around the natural scrub rather than paving it.
    const yardCandidates: Array<[number, number]> = [[-35, 58], [36, 66], [-42, 104], [43, 112], [-18, 128]];
    const yard = yardCandidates.find(([x, z]) => footprintIsSafe(x, z, 20, 22));
    if (yard) {
      const [yardX, yardZ] = yard;
      const yardGround = localGround(yardX, yardZ);
      if (yardGround !== null) {
        addBox(parts, [37, .055, 42], [yardX, yardGround + .025, yardZ], '#81795f');
        const shedX = yardX, shedZ = yardZ + 1, shedGround = localGround(shedX, shedZ);
        if (shedGround !== null) {
          const halfShedX = 10, halfShedZ = 9.7;
          // Raised timber floor, open boat-store front, weatherboard sides, and a deep split roof.
          addBox(parts, [14, .2, 17], [shedX, shedGround + .55, shedZ], '#77694f');
          for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
            addBox(parts, [.28, 1.25, .28], [shedX + sideX * 6.2, shedGround + .9, shedZ + sideZ * 7.5], '#5c503d');
          }
          addBox(parts, [13.2, 3.2, .32], [shedX, shedGround + 2.25, shedZ - 8.25], '#968a70');
          for (const sideX of [-1, 1]) addBox(parts, [.32, 3.2, 16], [shedX + sideX * 6.55, shedGround + 2.25, shedZ], '#968a70');
          addBox(parts, [8.2, .2, 18.4], [shedX - 2.3, shedGround + 4.05, shedZ], '#687268', .43);
          addBox(parts, [8.2, .2, 18.4], [shedX + 2.3, shedGround + 4.05, shedZ], '#687268', -.43);
          // A pair of low cradles and a restrained upturned skiff suggest everyday boat upkeep.
          for (const rackZ of [-2.8, 2.8]) {
            addBox(parts, [1.1, .16, 8], [shedX - 2.1, shedGround + 1.25, shedZ + rackZ], '#5f513d');
            addBox(parts, [1.1, .16, 8], [shedX + 2.1, shedGround + 1.25, shedZ + rackZ], '#5f513d');
          }
          addBox(parts, [1.35, .34, 7.2], [shedX, shedGround + 1.53, shedZ], '#765c43');
          addCylinder(parts, .36, 1.1, [shedX + 4.8, shedGround + .95, shedZ + 5.2], '#647267');
          structureColliders.push(localCollider(shedX, shedZ, halfShedX, halfShedZ, shedGround, shedGround + 6, 'coastal boat store shed'));
          coastalYardCount++;
        }

        const pathLength = Math.max(1, yardZ - 17), segments = Math.ceil(pathLength / 5.5);
        for (let segment = 0; segment < segments; segment++) {
          const progress = (segment + .5) / segments;
          const z = 17 + progress * pathLength;
          const x = yardX * progress + Math.sin(progress * Math.PI * 2.1) * 4.2;
          const point = localPoint(x, z), ground = localGround(x, z);
          if (ground === null || !safePoint(point, 390)) continue;
          addBox(parts, [2.35, .065, pathLength / segments + .35], [x, ground + .035, z], segment % 3 === 0 ? '#93876a' : '#897f64');
          footpathSegments++;
        }

        // Three sides of a low, open fishing-yard fence keep the path mouth clear. A single
        // conservative bound covers its connected rails and posts for aircraft collision checks.
        if (footprintIsSafe(yardX, yardZ, 20, 22)) {
          const fenceBottom = yardGround, fenceTop = yardGround + 1.55;
          for (const sideX of [-18, 18]) {
            for (const postZ of [-10, 0, 10]) addBox(parts, [.2, 1.55, .2], [yardX + sideX, fenceBottom + .78, yardZ + postZ], '#5c503d');
            addBox(parts, [.16, .14, 21], [yardX + sideX, fenceBottom + 1.05, yardZ], '#6d5b43');
            addBox(parts, [.16, .14, 21], [yardX + sideX, fenceBottom + .48, yardZ], '#6d5b43');
          }
          for (const postX of [-9, 0, 9]) addBox(parts, [.2, 1.55, .2], [yardX + postX, fenceBottom + .78, yardZ + 20], '#5c503d');
          addBox(parts, [38, .14, .16], [yardX, fenceBottom + 1.05, yardZ + 20], '#6d5b43');
          addBox(parts, [38, .14, .16], [yardX, fenceBottom + .48, yardZ + 20], '#6d5b43');
          structureColliders.push(localCollider(yardX, yardZ + 5, 19.2, 15.8, fenceBottom, fenceTop, 'coastal fishing-yard fence'));
          coastalYardCount++;
        }
      }
    }

    const structureGeometry = merge(parts);
    const structureMesh = new THREE.Mesh(structureGeometry, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .96 }));
    structureMesh.position.set(structureAnchor.x, 0, structureAnchor.z);
    structureMesh.rotation.y = structureYaw;
    structureMesh.castShadow = true; structureMesh.receiveShadow = true; structureMesh.name = 'Stilt fishing hut and jetty';
    root.add(structureMesh);

    const bulbs: THREE.BufferGeometry[] = [];
    for (const x of [-3.2, 3.2]) {
      const bulb = new THREE.SphereGeometry(.19, 7, 5);
      bulb.translate(x, lampDeck + 2.22, lampD - 47);
      bulbs.push(bulb);
    }
    for (const x of [-1.65, 1.65]) {
      const window = new THREE.BoxGeometry(.95, .78, .07);
      window.translate(x, floor + 1.72, -3.48);
      bulbs.push(window);
    }
    const sideWindow = new THREE.BoxGeometry(.07, .78, 1.1);
    sideWindow.translate(3.62, floor + 1.72, .8);
    bulbs.push(sideWindow);
    lampMaterial = new THREE.MeshStandardMaterial({ color: '#ffb76a', emissive: '#ff8b36', emissiveIntensity: 0, roughness: .35 });
    const lampGeometry = mergeGeometries(bulbs)!;
    bulbs.forEach(geometry => geometry.dispose());
    lampMesh = new THREE.Mesh(lampGeometry, lampMaterial);
    lampMesh.position.set(structureAnchor.x, 0, structureAnchor.z); lampMesh.rotation.y = structureMesh.rotation.y;
    lampMesh.name = 'Jetty lamps'; root.add(lampMesh);
    const practical = sampler.fromLocal(sampler.coastAt(s) + lampD, s);
    lightingAnchor = { x: practical.x, y: lampDeck + 2.22, z: practical.z };
  }

  // A reusable matrix update keeps all moored boats in phase with simulation time.
  const updateBoats = (time: number) => {
    for (const boat of boatRecords) {
      dummy.position.set(boat.x, boat.baseY + Math.sin(time * .95 + boat.phase) * boat.amplitude, boat.z);
      dummy.rotation.set(Math.sin(time * .7 + boat.phase) * .012, boat.yaw, Math.sin(time * .8 + boat.phase) * .018);
      dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      boatMeshes[boat.variant].setMatrixAt(boat.index, dummy.matrix);
    }
    boatMeshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
  };
  updateBoats(0);

  scene.add(root);
  root.updateMatrixWorld(true);
  let coastalDrawCalls = 0, coastalTriangles = 0;
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    coastalDrawCalls++;
    const triangles = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.getAttribute('position').count / 3;
    coastalTriangles += triangles * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
  });
  const stats = { coastalDrawCalls, coastalTriangles, boatCount: boatRecords.length, mangroveCount, mangrovePocketCount, grassCount: grassCounts[0] + grassCounts[1], footpathSegments, coastalYardCount };
  root.userData = { ...root.userData, ...stats };
  scene.userData.coastalDetails = root.userData;

  return {
    treeColliders,
    structureColliders,
    boats,
    lightingAnchor,
    stats,
    update(time: number, nightStrength = 0) {
      updateBoats(time);
      if (lampMaterial) lampMaterial.emissiveIntensity = Math.max(0, Math.min(1, nightStrength)) * 2.2;
    },
    dispose() {
      root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(mat => mat.dispose());
      });
      root.removeFromParent();
      if (scene.userData.coastalDetails === root.userData) delete scene.userData.coastalDetails;
    },
  };
}
