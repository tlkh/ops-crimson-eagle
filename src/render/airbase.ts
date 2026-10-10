import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import { getCampaignGeography, sampleRoad, type CampaignRoad, type LocalPoint } from '../content/geography';
import { campaignTerrainFrame } from '../content/terrainFrame';
import type { StructureCollider } from '../sim/collision';
import { isWithinLakeOutline } from '../sim/lakeShape';
import type { BurnField } from './burnField';
import type { VegetationExclusionZone } from './landUse';

type Point = { x: number; z: number };
type ApronPoint = Point;

export type JapanAirbaseStats = {
  fenceMetres: number;
  fenceSections: number;
  buildingCount: number;
  gateCount: number;
  roadLengthMetres: number;
  roadJoinIds: string[];
};

export type JapanAirbaseResult = {
  roads: readonly CampaignRoad[];
  vegetationExclusionZones: VegetationExclusionZone[];
  structureExclusionZones: VegetationExclusionZone[];
  burnProtectedZones: VegetationExclusionZone[];
  structureColliders: StructureCollider[];
  stats: JapanAirbaseStats;
  applyBurnField(field: BurnField): void;
  dispose(): void;
};

export type JapanAirbaseContext = {
  /** Convert airbase-local x/z into the campaign's world x/z. */
  toWorld(point: ApronPoint): Point;
  terrainHeight(x: number, z: number): number;
  renderedTerrainHeight(x: number, z: number): number | null;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const color = (value: THREE.ColorRepresentation, roughness = .9, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color: value, roughness, metalness });

function closestPoint(point: LocalPoint, a: LocalPoint, b: LocalPoint): LocalPoint {
  const dt = b.t - a.t, ds = b.s - a.s;
  const lengthSquared = dt * dt + ds * ds;
  const fraction = lengthSquared === 0 ? 0 : clamp(((point.t - a.t) * dt + (point.s - a.s) * ds) / lengthSquared, 0, 1);
  return { t: a.t + dt * fraction, s: a.s + ds * fraction };
}

function pointOnRoad(start: LocalPoint, roads: readonly CampaignRoad[]): Array<{ road: CampaignRoad; point: LocalPoint; distance: number }> {
  const candidates: Array<{ road: CampaignRoad; point: LocalPoint; distance: number }> = [];
  for (const road of roads) {
    const points = sampleRoad(road.points, 8);
    for (let index = 1; index < points.length; index++) {
      const point = closestPoint(start, points[index - 1], points[index]);
      candidates.push({ road, point, distance: Math.hypot(point.t - start.t, point.s - start.s) });
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance);
}

function makeRoadGeometry(
  points: readonly LocalPoint[],
  width: number,
  lift: number,
  toApron: (point: LocalPoint) => ApronPoint,
  toWorld: (point: ApronPoint) => Point,
  groundAt: (point: Point) => number,
): THREE.BufferGeometry {
  const sampled = sampleRoad(points, 8);
  const positions: number[] = [];
  const indices: number[] = [];
  const half = width * .5;
  for (let index = 0; index < sampled.length; index++) {
    const before = sampled[Math.max(0, index - 1)], after = sampled[Math.min(sampled.length - 1, index + 1)];
    const dt = after.t - before.t, ds = after.s - before.s;
    const length = Math.max(.001, Math.hypot(dt, ds));
    const nt = -ds / length, ns = dt / length;
    for (const side of [-1, 1]) {
      const apron = toApron({ t: sampled[index].t + nt * half * side, s: sampled[index].s + ns * half * side });
      const point = toWorld(apron);
      positions.push(apron.x, groundAt(point) + lift, apron.z);
    }
    if (index < sampled.length - 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function isRoadClear(
  campaign: Campaign,
  mission: Mission,
  toWorld: (point: ApronPoint) => Point,
  points: readonly LocalPoint[],
  routeLength: number,
): boolean {
  for (const roadPoint of sampleRoad(points, 8)) {
    const apronPoint = { x: -roadPoint.s, z: roadPoint.t - routeLength };
    const world = toWorld(apronPoint);
    if (isWithinLakeOutline(campaign.id, mission.lake, world, 24)) return false;
    const river = -850 + 120 * Math.sin(roadPoint.t * .0021) + 75 * Math.sin(roadPoint.t * .0053);
    if (Math.abs(roadPoint.s - river) < 68 + 14) return false;
  }
  return true;
}

/** Authored perimeter, access roads, and support facilities for the Japan theatre. */
export function createJapanAirbase(
  scene: THREE.Scene,
  campaign: Campaign,
  mission: Mission,
  context: JapanAirbaseContext,
): JapanAirbaseResult | null {
  if (campaign.id !== 'jp_ketapang_2026_09' || !mission.shore) return null;

  const geography = getCampaignGeography(campaign);
  const target = mission.shore;
  const { length: routeLength, ux, uz } = campaignTerrainFrame(campaign, mission);
  const localToRoad = (point: ApronPoint): LocalPoint => ({ t: routeLength + point.z, s: -point.x });
  const roadToLocal = (point: LocalPoint): ApronPoint => ({ x: -point.s, z: point.t - routeLength });
  const roads: CampaignRoad[] = [];
  const spine = geography.roads.find(road => road.id === 'sector-access-spine');
  if (!spine) throw new Error('Japan airbase needs the connected sector access road');

  const gateSpecs = [
    { id: 'west-main-gate', z: 378, width: 24 },
    { id: 'west-service-gate', z: 652, width: 22 },
  ] as const;
  for (const gate of gateSpecs) {
    const roadStart = localToRoad({ x: -190, z: gate.z });
    const join = pointOnRoad(roadStart, [spine]).find(candidate =>
      isRoadClear(campaign, mission, context.toWorld, [roadStart, candidate.point], routeLength));
    if (!join) throw new Error(`Could not connect Japan airbase ${gate.id} to the campaign road network`);
    roads.push({
      id: `japan-airbase-${gate.id}`,
      kind: 'gravel',
      points: [roadStart, join.point],
    });
  }

  const internalRoads: CampaignRoad[] = [
    {
      id: 'japan-airbase-internal-access', kind: 'paved',
      points: [
        localToRoad({ x: -190, z: 378 }), localToRoad({ x: -145, z: 378 }),
        localToRoad({ x: -112, z: 350 }), localToRoad({ x: -112, z: -145 }),
        localToRoad({ x: 35, z: -145 }), localToRoad({ x: 35, z: 755 }),
      ],
    },
    {
      id: 'japan-airbase-service-access', kind: 'gravel',
      points: [
        localToRoad({ x: -190, z: 652 }), localToRoad({ x: -145, z: 652 }),
        localToRoad({ x: -112, z: 625 }), localToRoad({ x: 35, z: 625 }),
      ],
    },
    ...[
      { id: 'operations-drive', points: [{ x: 35, z: 170 }, { x: 112, z: 170 }] },
      { id: 'hangar-drive', points: [{ x: 35, z: 286 }, { x: 105, z: 286 }] },
      { id: 'stores-drive', points: [{ x: 35, z: 430 }, { x: 126, z: 430 }] },
      { id: 'workshop-drive', points: [{ x: 35, z: 555 }, { x: 126, z: 555 }] },
      { id: 'parking-drive', points: [{ x: 35, z: 625 }, { x: 98, z: 625 }] },
      { id: 'fuel-farm-drive', points: [{ x: 35, z: 755 }, { x: 118, z: 755 }] },
      { id: 'rescue-drive', points: [{ x: 35, z: 480 }, { x: -27, z: 480 }] },
    ].map(road => ({ id: `japan-airbase-${road.id}`, kind: 'gravel' as const, points: road.points.map(localToRoad) })),
  ];
  roads.push(...internalRoads);

  const root = new THREE.Group();
  root.name = 'Rahadi Oesman airbase perimeter and facilities';
  root.position.set(target.x, 0, target.z);
  root.rotation.y = Math.atan2(ux, uz);
  scene.add(root);

  const postMaterial = color('#414b43', .72, .22);
  const roadSurface = color('#4b5048', .98);
  const roadShoulder = color('#817860', 1);
  const wall = color('#b1b3a8', .86);
  const roof = color('#4f5b57', .76, .14);
  const darkMetal = color('#38433f', .7, .3);
  const glass = color('#708985', .32, .08);
  const paint = color('#c1bfab', .9);
  const materials: THREE.Material[] = [postMaterial, roadSurface, roadShoulder, wall, roof, darkMetal, glass, paint];

  const structureColliders: StructureCollider[] = [];
  const burnProtectedZones: VegetationExclusionZone[] = [];
  const structureExclusionZones: VegetationExclusionZone[] = [];
  const vegetationExclusionZones: VegetationExclusionZone[] = [];
  const burnableRoadMeshes: Array<{ mesh: THREE.Mesh; baseColor: THREE.Color }> = [];
  let buildingCount = 0;
  let fenceMetres = 0;
  let fenceSections = 0;
  let roadLengthMetres = 0;

  const groundAt = (point: Point) => context.renderedTerrainHeight(point.x, point.z) ?? context.terrainHeight(point.x, point.z);
  const addBox = (
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    name: string,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const addLocalCollider = (x: number, z: number, halfWidth: number, halfLength: number, bottom: number, top: number, label: string) => {
    const center = context.toWorld({ x, z });
    const xAxis = context.toWorld({ x: x + halfWidth, z });
    const zAxis = context.toWorld({ x, z: z + halfLength });
    const worldHalfWidth = Math.abs(xAxis.x - center.x) + Math.abs(zAxis.x - center.x);
    const worldHalfLength = Math.abs(xAxis.z - center.z) + Math.abs(zAxis.z - center.z);
    structureColliders.push({ x: center.x, z: center.z, halfWidth: worldHalfWidth, halfLength: worldHalfLength, bottom, top, label });
  };
  const addFootprint = (x: number, z: number, radius: number, burnProtected: boolean) => {
    const world = context.toWorld({ x, z });
    const zone = { x: world.x, z: world.z, radius };
    structureExclusionZones.push(zone);
    if (burnProtected) burnProtectedZones.push(zone);
  };

  // The polygon follows the actual safe land between the runway end and the irregular lake.
  // Vehicle openings are short sections on the west side, each with a checkpoint.
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.075, .09, 2.55, 6), postMaterial, 600);
  posts.name = 'Airbase chain-link fence posts';
  posts.castShadow = true;
  const wireSegments: number[] = [];
  const fenceColliders: StructureCollider[] = [];
  const fencePath: ApronPoint[][] = [
    [{ x: -190, z: -170 }, { x: 390, z: -170 }],
    [{ x: 390, z: -170 }, { x: 390, z: 930 }],
    // The sector track crosses through an open northern service entrance.
    [{ x: 390, z: 930 }, { x: 352, z: 926.65 }],
    [{ x: 315, z: 923.38 }, { x: 220, z: 915 }, { x: 80, z: 870 }, { x: -80, z: 810 }, { x: -190, z: 780 }],
    [{ x: -190, z: 780 }, { x: -190, z: 664 }],
    [{ x: -190, z: 642 }, { x: -190, z: 390 }],
    [{ x: -190, z: 366 }, { x: -190, z: -170 }],
  ];
  const dummy = new THREE.Object3D();
  let postCount = 0;
  const addFenceRun = (path: readonly ApronPoint[]) => {
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1], b = path[index];
      const aWorld = context.toWorld(a), bWorld = context.toWorld(b);
      const length = distance(aWorld, bWorld);
      if (length < .1) continue;
      fenceMetres += length;
      const segments = Math.ceil(length / 8);
      for (let segment = 0; segment < segments; segment++) {
        const u0 = segment / segments, u1 = Math.min(1, (segment + 1) / segments);
        const p0 = { x: a.x + (b.x - a.x) * u0, z: a.z + (b.z - a.z) * u0 };
        const p1 = { x: a.x + (b.x - a.x) * u1, z: a.z + (b.z - a.z) * u1 };
        const w0 = context.toWorld(p0), w1 = context.toWorld(p1);
        const y0 = groundAt(w0), y1 = groundAt(w1);
        const span = distance(w0, w1);
        if (segment === 0) {
          dummy.position.set(p0.x, y0 + 1.275, p0.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posts.setMatrixAt(postCount++, dummy.matrix);
        }
        dummy.position.set(p1.x, y1 + 1.275, p1.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posts.setMatrixAt(postCount++, dummy.matrix);
        // Three horizontal rails plus a fine wire grid produce a chain-link reading at range.
        for (const level of [.22, 1.25, 2.3]) {
          wireSegments.push(p0.x, y0 + level, p0.z, p1.x, y1 + level, p1.z);
        }
        const wireCount = Math.max(1, Math.ceil(span / 1.25));
        for (let wire = 0; wire <= wireCount; wire++) {
          const u = wire / wireCount;
          const point = { x: THREE.MathUtils.lerp(p0.x, p1.x, u), z: THREE.MathUtils.lerp(p0.z, p1.z, u) };
          const y = THREE.MathUtils.lerp(y0, y1, u);
          wireSegments.push(point.x, y + .18, point.z, point.x, y + 2.35, point.z);
        }
        // A short AABB section keeps the collision representation close to the visible run.
        const centerX = (w0.x + w1.x) * .5, centerZ = (w0.z + w1.z) * .5;
        fenceColliders.push({
          x: centerX, z: centerZ,
          halfWidth: Math.abs(w1.x - w0.x) * .5 + .18,
          halfLength: Math.abs(w1.z - w0.z) * .5 + .18,
          bottom: Math.min(y0, y1), top: Math.max(y0, y1) + 2.45,
          label: 'Airbase perimeter fence',
        });
        fenceSections++;
        for (let d = 0; d <= span; d += 12) {
          const u = span > 0 ? Math.min(1, d / span) : 0;
          const world = context.toWorld({ x: THREE.MathUtils.lerp(p0.x, p1.x, u), z: THREE.MathUtils.lerp(p0.z, p1.z, u) });
          vegetationExclusionZones.push({ x: world.x, z: world.z, radius: 12 });
          structureExclusionZones.push({ x: world.x, z: world.z, radius: 12 });
        }
      }
    }
  };
  for (const path of fencePath) addFenceRun(path);
  posts.count = postCount;
  posts.instanceMatrix.needsUpdate = true;
  root.add(posts);
  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireSegments, 3));
  const wires = new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: '#697366', transparent: true, opacity: .78 }));
  wires.name = 'Airbase chain-link wire mesh';
  root.add(wires);
  structureColliders.push(...fenceColliders);

  const gateMarkers = [
    { id: 'main gate', x: -190, z: 378 },
    { id: 'service gate', x: -190, z: 652 },
  ];
  for (const gate of gateMarkers) {
      const boothX = -165;
      const boothZ = gate.z + 18;
      const point = context.toWorld({ x: boothX, z: boothZ });
      const y = groundAt(point);
      const booth = new THREE.Group();
      booth.name = `Airbase ${gate.id} checkpoint booth`;
      addBox(booth, [8, 3.2, 6], [0, y + 1.6, 0], wall, 'Checkpoint booth');
      addBox(booth, [8.8, .55, 6.8], [0, y + 3.45, 0], roof, 'Checkpoint canopy');
      addBox(booth, [5.5, 1.5, .16], [0, y + 1.85, 3.08], glass, 'Checkpoint window');
      booth.position.set(boothX, 0, boothZ);
      root.add(booth);
      const colliderCenter = context.toWorld({ x: boothX, z: boothZ });
      const hx = context.toWorld({ x: boothX + 4.4, z: boothZ });
      const hz = context.toWorld({ x: boothX, z: boothZ + 3.4 });
      structureColliders.push({
        x: colliderCenter.x, z: colliderCenter.z,
        halfWidth: Math.abs(hx.x - colliderCenter.x) + Math.abs(hz.x - colliderCenter.x),
        halfLength: Math.abs(hx.z - colliderCenter.z) + Math.abs(hz.z - colliderCenter.z),
        bottom: y, top: y + 4, label: `Airbase ${gate.id} checkpoint`,
      });
      addFootprint(boothX, boothZ, 12, true);
      roads.push({
        id: `japan-airbase-${gate.id.replaceAll(' ', '-')}-checkpoint-drive`,
        kind: 'gravel',
        points: [localToRoad({ x: -145, z: gate.z }), localToRoad({ x: -155, z: gate.z + 9 }), localToRoad({ x: boothX + 5, z: boothZ })],
      });
    // The striped boom is raised so the road remains passable in the authored scene.
    const barrierPoint = context.toWorld({ x: -177, z: gate.z + 12 });
    const barrierY = groundAt(barrierPoint);
    const barrier = new THREE.Group();
    barrier.name = `Airbase ${gate.id} barrier`;
    barrier.position.set(-177, barrierY, gate.z + 12);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.28, .34, 1.6, 8), darkMetal);
    post.position.set(0, .8, 0); barrier.add(post);
    const pivot = new THREE.Group();
    pivot.position.y = 1.5;
    pivot.rotation.x = Math.PI / 2 - .13;
    barrier.add(pivot);
    addBox(pivot, [.24, .24, 8], [0, 0, -4], paint, 'Raised barrier arm');
    for (let z = -1; z > -8; z -= 1.5) addBox(pivot, [.26, .26, .5], [0, 0, z], darkMetal, 'Barrier warning stripe');
    root.add(barrier);
    barrier.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(barrier);
    structureColliders.push({ x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2,
      halfWidth: (bounds.max.x - bounds.min.x) / 2, halfLength: (bounds.max.z - bounds.min.z) / 2,
      bottom: bounds.min.y, top: bounds.max.y, label: barrier.name });
  }

  const addBuilding = (
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    wallHeight: number,
    bodyMaterial = wall,
    roofMaterial = roof,
  ) => {
    const point = context.toWorld({ x, z });
    const ground = groundAt(point);
    const building = new THREE.Group();
    building.name = `Airbase ${name}`;
    addBox(building, [width, wallHeight, depth], [0, ground + wallHeight / 2, 0], bodyMaterial, `${name} walls`);
    addBox(building, [width + 4, .8, depth + 4], [0, ground + wallHeight + .4, 0], roofMaterial, `${name} roof`);
    building.position.set(x, 0, z);
    root.add(building);
    const center = context.toWorld({ x, z });
    const halfX = context.toWorld({ x: x + width * .5 + 2, z });
    const halfZ = context.toWorld({ x, z: z + depth * .5 + 2 });
    structureColliders.push({
      x: center.x, z: center.z,
      halfWidth: Math.abs(halfX.x - center.x) + Math.abs(halfZ.x - center.x),
      halfLength: Math.abs(halfX.z - center.z) + Math.abs(halfZ.z - center.z),
      bottom: ground, top: ground + wallHeight + .8, label: `Airbase ${name}`,
    });
    addFootprint(x, z, Math.hypot(width, depth) * .58 + 12, true);
    buildingCount++;
    return { building, ground };
  };

  // A hangar, operations block, emergency response and maintenance facilities give the field a working scale.
  const hangar = addBuilding('CH-47 maintenance hangar', 152, 286, 82, 68, 11, color('#8e9a8e'), color('#4c5a55', .72, .12));
  addBox(hangar.building, [.45, 7.8, 44], [-41.15, hangar.ground + 4.25, 0], darkMetal, 'Hangar door frame');
  addBox(hangar.building, [.2, 6.8, 42], [-41.45, hangar.ground + 4, 0], color('#53615c', .82, .08), 'Hangar sliding door');
  for (let z = -18; z <= 18; z += 6) addBox(hangar.building, [.3, 6.8, .18], [-41.6, hangar.ground + 4, z], paint, 'Hangar door rib');
  const operations = addBuilding('air operations centre', 145, 170, 52, 36, 7.2, wall, color('#515e58', .76, .1));
  for (const z of [-12, 0, 12]) addBox(operations.building, [.18, 2.8, 6], [26.15, operations.ground + 4.6, z], glass, 'Operations centre window');
  addBuilding('airport fire and rescue station', -48, 480, 34, 26, 6, color('#9a9b88'), color('#863d32', .8));
  addBuilding('airfield service stores', 154, 430, 44, 32, 7, color('#9fa394'), color('#59635b', .83));
  addBuilding('ground support workshop', 154, 555, 46, 36, 8, color('#92998f'), color('#45534e', .78, .08));
  const northCheckpoint = addBuilding('north service checkpoint', 322, 898, 8, 6, 3.2);
  addBox(northCheckpoint.building, [5, 1.3, .16], [0, northCheckpoint.ground + 2, 3.08], glass, 'Northern checkpoint window');
  const northJoin = pointOnRoad(localToRoad({ x: 334, z: 925 }), [spine])[0].point;
  roads.push({ id: 'japan-airbase-north-checkpoint-drive', kind: 'gravel', points: [northJoin, localToRoad({ x: 316, z: 898 })] });

  // A bounded fuel point sits beside the service road, away from the runway threshold and approach line.
  const tankMaterial = color('#68736b', .65, .28);
  materials.push(tankMaterial);
  for (const [index, x, z] of [[0, 145, 755], [1, 180, 755], [2, 145, 790]] as const) {
    const point = context.toWorld({ x, z });
    const ground = groundAt(point);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 8, 10, 16), tankMaterial);
    tank.name = `Airbase fuel tank ${index + 1}`;
    tank.position.set(x, ground + 5, z);
    root.add(tank);
    addLocalCollider(x, z, 8, 8, ground, ground + 10, 'Airbase fuel tank');
    addFootprint(x, z, 20, true);
    buildingCount++;
  }

  const addVehicle = (name: string, x: number, z: number, bodyColor: THREE.Material) => {
    const point = context.toWorld({ x, z });
    const ground = groundAt(point);
    const vehicle = new THREE.Group();
    vehicle.name = `Airbase ${name}`;
    addBox(vehicle, [3.4, 2.2, 7.5], [0, ground + 1.6, 0], bodyColor, `${name} body`);
    addBox(vehicle, [2.8, 1.4, 3.1], [0, ground + 3.25, -.5], glass, `${name} cab`);
    for (const wx of [-1.35, 1.35]) for (const wz of [-2.4, 2.4]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .35, 8), darkMetal);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, ground + .6, wz); vehicle.add(wheel);
    }
    vehicle.position.set(x, 0, z);
    root.add(vehicle);
    addLocalCollider(x, z, 2.1, 4.2, ground, ground + 4, `Airbase ${name}`);
    addFootprint(x, z, 9, true);
    buildingCount++;
  };
  addVehicle('airport fire engine', -76, 500, color('#a43b2e', .78));
  addVehicle('fuel bowser', 174, 510, color('#bdad62', .86));
  addVehicle('airfield tractor', 142, 625, color('#a64b34', .78));

  // Give each facility driveway a working forecourt instead of bare road ends.
  const supplySites = [
    { x: 108, z: 183, name: 'operations supplies' },
    { x: 99, z: 310, name: 'hangar ground equipment' },
    { x: 123, z: 444, name: 'stores delivery yard' },
    { x: 123, z: 570, name: 'maintenance equipment' },
    { x: 120, z: 772, name: 'fuel service equipment' },
  ];
  const supplies = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.2, 1.5), color('#7b755a'), supplySites.length * 3);
  supplies.name = 'Airbase facility supply clusters';
  supplies.castShadow = true; supplies.receiveShadow = true;
  let supplyIndex = 0;
  for (const site of supplySites) {
    for (const [offsetX, offsetZ] of [[0, 0], [2.3, 0], [0, 2.1]]) {
      const x = site.x + offsetX, z = site.z + offsetZ;
      const ground = groundAt(context.toWorld({ x, z }));
      supplies.setMatrixAt(supplyIndex++, new THREE.Matrix4().makeTranslation(x, ground + .6, z));
      addLocalCollider(x, z, .9, .75, ground, ground + 1.2, `Airbase ${site.name}`);
    }
    addFootprint(site.x, site.z, 6, true);
  }
  root.add(supplies);

  // The windsock points downwind in the apron frame.
  const windPoint = context.toWorld({ x: 310, z: 120 });
  const windY = groundAt(windPoint);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, 9, 8), darkMetal);
  pole.position.set(310, windY + 4.5, 120); root.add(pole);
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(.12, .28, 3.3, 8, 1, true), color('#d5b83d', .72));
  const wind = new THREE.Vector3(mission.wind.x, 0, mission.wind.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -root.rotation.y);
  if (wind.lengthSq() < .01) wind.set(0, 0, 1);
  wind.normalize();
  sock.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wind);
  sock.position.set(310 + wind.x * 1.65, windY + 8.2, 120 + wind.z * 1.65); root.add(sock);
  addLocalCollider(310, 120, .15, .15, windY, windY + 9, 'Airbase windsock mast');

  const addRoad = (road: CampaignRoad, shoulderWidth: number, surfaceWidth: number) => {
    let length = 0;
    const sampled = sampleRoad(road.points, 8);
    for (let index = 1; index < sampled.length; index++) length += Math.hypot(sampled[index].t - sampled[index - 1].t, sampled[index].s - sampled[index - 1].s);
    roadLengthMetres += length;
    const toApron = (point: LocalPoint) => roadToLocal(point);
    for (const [width, lift, material, label] of [
      [shoulderWidth, .12, roadShoulder, `${road.id} shoulder`],
      [surfaceWidth, .22, roadSurface, `${road.id} road`],
    ] as const) {
      const meshMaterial = material.clone() as THREE.MeshStandardMaterial;
      const baseColor = meshMaterial.color.clone();
      meshMaterial.color.set('#ffffff'); meshMaterial.vertexColors = true; meshMaterial.needsUpdate = true;
      materials.push(meshMaterial);
      const mesh = new THREE.Mesh(makeRoadGeometry(road.points, width, lift, toApron, context.toWorld, groundAt), meshMaterial);
      mesh.name = label; mesh.receiveShadow = true; root.add(mesh);
      burnableRoadMeshes.push({ mesh, baseColor });
    }

    // Dense circular samples keep trunks and the roadside rows out of both shoulders.
    for (let d = 0; d <= length; d += 10) {
      let remaining = d, point = sampled.at(-1)!;
      for (let index = 1; index < sampled.length; index++) {
        const a = sampled[index - 1], b = sampled[index], segmentLength = Math.hypot(b.t - a.t, b.s - a.s);
        if (remaining <= segmentLength || index === sampled.length - 1) {
          const t = segmentLength > 0 ? remaining / segmentLength : 0;
          point = { t: THREE.MathUtils.lerp(a.t, b.t, t), s: THREE.MathUtils.lerp(a.s, b.s, t) };
          break;
        }
        remaining -= segmentLength;
      }
      const local = roadToLocal(point), world = context.toWorld(local);
      vegetationExclusionZones.push({ x: world.x, z: world.z, radius: shoulderWidth * .5 + 18 });
    }
  };
  for (const road of roads) addRoad(road, road.kind === 'paved' ? 10 : 7.2, road.kind === 'paved' ? 6 : 4.5);

  // Internal roads reach the hangar and stores; the north runway corridor remains open.
  const parkingLot = new THREE.Mesh(new THREE.PlaneGeometry(92, 42), roadShoulder);
  parkingLot.name = 'Airbase service vehicle parking';
  parkingLot.rotation.x = -Math.PI / 2;
  const parkingPoint = context.toWorld({ x: 140, z: 625 });
  parkingLot.position.set(140, groundAt(parkingPoint) + .08, 625);
  root.add(parkingLot);
  for (let index = 0; index < 6; index++) {
    const x = 107 + index * 15, linePoint = context.toWorld({ x, z: 625 });
    addBox(root, [.22, .06, 18], [x, groundAt(linePoint) + .13, 625], paint, 'Airbase parking bay line');
  }
  addFootprint(140, 625, 75, true);

  // Each perimeter light has a visible mast and a matching collision footprint.
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(.65, .65, .65), color('#bfae6a', .5, .35), 22);
  lights.name = 'Airbase perimeter lights';
  const lightPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.1, .14, 3.6, 6), darkMetal, 22);
  lightPoles.name = 'Airbase perimeter light poles';
  let lightCount = 0;
  for (const [x, z] of [[-190,-80],[-190,60],[-190,220],[-190,520],[-190,730],[390,-80],[390,100],[390,320],[390,560],[390,760],[390,930],[220,935],[20,850]] as const) {
    const point = context.toWorld({ x, z });
    const ground = groundAt(point);
    lights.setMatrixAt(lightCount, new THREE.Matrix4().makeTranslation(x, ground + 3.9, z));
    lightPoles.setMatrixAt(lightCount, new THREE.Matrix4().makeTranslation(x, ground + 1.8, z));
    addLocalCollider(x, z, .325, .325, ground, ground + 4.225, 'Airbase perimeter light pole');
    lightCount++;
  }
  lights.count = lightCount; lights.instanceMatrix.needsUpdate = true; root.add(lights);
  lightPoles.count = lightCount; lightPoles.instanceMatrix.needsUpdate = true; root.add(lightPoles);

  root.updateMatrixWorld(true);
  const roadJoinIds = roads.filter(road => road.id.startsWith('japan-airbase-west-')).map(road => {
    const join = road.points.at(-1)!;
    return `${road.id}->sector-access-spine@${join.t.toFixed(1)},${join.s.toFixed(1)}`;
  });
  const stats = { fenceMetres, fenceSections, buildingCount, gateCount: gateSpecs.length + 1, roadLengthMetres, roadJoinIds };
  // The runway end extends beyond the older circular airport tree clearance.
  for (let z = -120; z <= 900; z += 60) {
    const world = context.toWorld({ x: 235, z });
    const zone = { x: world.x, z: world.z, radius: 85 };
    vegetationExclusionZones.push(zone);
    structureExclusionZones.push(zone);
  }

  return {
    roads,
    vegetationExclusionZones,
    structureExclusionZones,
    burnProtectedZones,
    structureColliders,
    stats,
    applyBurnField(field) {
      const singedTint = new THREE.Color('#6b4931');
      const ashTint = new THREE.Color('#746d60');
      const charcoalTint = new THREE.Color('#211f1a');
      const smooth = (low: number, high: number, value: number) => {
        const t = clamp((value - low) / (high - low), 0, 1);
        return t * t * (3 - 2 * t);
      };
      for (const { mesh, baseColor } of burnableRoadMeshes) {
        const position = mesh.geometry.getAttribute('position');
        const colors = new Float32Array(position.count * 3);
        const tint = new THREE.Color();
        for (let index = 0; index < position.count; index++) {
          const world = context.toWorld({ x: position.getX(index), z: position.getZ(index) });
          const sample = field.sample(world.x, world.z);
          const charCore = smooth(.49, .77, sample.severity) * (1 - .58 * smooth(.28, .94, sample.age));
          const ashLayer = smooth(.23, .56, sample.severity) * smooth(.24, .79, sample.age) * (1 - .28 * charCore);
          const singedFringe = smooth(.012, .16, sample.severity) * (1 - smooth(.36, .68, sample.severity));
          tint.copy(baseColor).lerp(singedTint, singedFringe * .74).lerp(ashTint, ashLayer * .76).lerp(charcoalTint, charCore * .94);
          colors[index * 3] = tint.r; colors[index * 3 + 1] = tint.g; colors[index * 3 + 2] = tint.b;
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
        const material = mesh.material;
        if (Array.isArray(material)) for (const item of material) usedMaterials.add(item);
        else if (material) usedMaterials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const item of materials) usedMaterials.add(item);
      for (const item of usedMaterials) item.dispose();
    },
  };
}
