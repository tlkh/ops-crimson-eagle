import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import { renderedTerrainHeight, setRenderedTerrainHeights, setStructureColliders, setTreeColliders, terrainHeight as collisionTerrainHeight, TERRAIN_GRID } from '../sim/collision';
import type { StructureCollider, TreeCollider } from '../sim/collision';
import { createAtmosphere } from './atmosphere';
import { createWater } from './water';
import { createCoastalDetails } from './coastalDetails';
import { createCoastalSampler } from './coastalSampling';
import { createGroundSurface } from './groundSurface';
import { createLandUse } from './landUse';
import { createVegetation } from './vegetation';
import { createDistantScenery } from './distantScenery';
import type { RenderQualityProfile } from './quality';
import type { TextureAssets } from './textureAssets';
import { createBurnField, isBurnProtectedAirport } from './burnField';

type V = { x: number; z: number };
const TAU = Math.PI * 2;
const distance = (a: V, b: V) => Math.hypot(a.x - b.x, a.z - b.z);
const seeded = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const material = (color: THREE.ColorRepresentation, roughness = .94) => new THREE.MeshStandardMaterial({ color, roughness });
function block(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], mat: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position); mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

/** Reference-informed, deliberately compressed lowland composition; not surveyed geography.
 * Keep all freshwater at y=0 and operational ground within 0.6 m of sim ground.
 * See docs/map-geometry-references.md for evidence and reconstruction boundaries. */
export function createWorld(scene: THREE.Scene, campaign: Campaign, mission: Mission, options: { preview?: boolean; textureAssets?: TextureAssets } = {}) {
  const atmosphere = createAtmosphere(scene, campaign, mission, { preview: options.preview });
  const jp = campaign.id === 'jp_ketapang_2026_09';
  // Fixed theatre seed: the coastline and forest do not rearrange between sorties.
  const random = seeded(jp ? 62017 : 62135);
  const target = mission.shore ?? mission.lake;
  const coastalSampler = createCoastalSampler(campaign, mission);
  const dx = target.x - mission.ship.x, dz = target.z - mission.ship.z;
  const routeLength = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / routeLength, uz = dz / routeLength, sx = -uz, sz = ux;
  const fromLocal = (t: number, s: number): V => ({ x: mission.ship.x + t * ux + s * sx, z: mission.ship.z + t * uz + s * sz });
  const local = (p: V) => ({ t: (p.x - mission.ship.x) * ux + (p.z - mission.ship.z) * uz, s: (p.x - mission.ship.x) * sx + (p.z - mission.ship.z) * sz });
  const flightLegs = campaign.missions.flatMap(m => {
    const first = m.shore ?? m.lake;
    return [[m.ship, first], [first, m.lake], [m.lake, m.fire]] as [V, V][];
  });
  const coast = coastalSampler.coastStart;
  const coastAt = coastalSampler.coastAt;
  const { inland, lateral, cols, rows } = TERRAIN_GRID;
  // One height field drives both the visible mesh and the aircraft collision
  // envelope. A null result is open water, which this land mesh never samples.
  const terrainHeight = (x: number, z: number) => collisionTerrainHeight(campaign, mission, x, z) ?? -9;
  const water = createWater(scene, campaign, mission, { reflections: !options.preview });
  water.surface(new THREE.PlaneGeometry(80000, 80000), 0, new THREE.Vector3(0, -9, 0));

  const positions: number[] = [], heights: number[] = [], colors: number[] = [], biomeWeights: number[] = [], uvs: number[] = [], indices: number[] = [];
  const smoothstep = (low: number, high: number, value: number) => {
    const v = THREE.MathUtils.clamp((value - low) / (high - low), 0, 1);
    return v * v * (3 - 2 * v);
  };
  const riverS = (t: number) => -850 + 120 * Math.sin(t * .0021) + 75 * Math.sin(t * .0053);
  for (let row = 0; row <= rows; row++) {
    const s = -lateral + row / rows * lateral * 2;
    for (let col = 0; col <= cols; col++) {
      const t = coastAt(s) + col / cols * (inland - coastAt(s));
      const p = fromLocal(t, s), height = terrainHeight(p.x, p.z);
      positions.push(p.x, height, p.z); heights.push(height); uvs.push(row / rows, col / cols);
      const shoreDistance = t - coastAt(s);
      const lakeDistance = distance(p, mission.lake) - mission.lake.radius;
      const riverDistance = Math.abs(s - riverS(t));
      const shoreSand = 1 - smoothstep(18, 170, shoreDistance);
      const lakeSand = (1 - smoothstep(0, 62, Math.abs(lakeDistance))) * .6;
      const sandWeight = Math.max(shoreSand, lakeSand);
      const wetPatch = .5 + .5 * Math.sin(t * .0067 + Math.sin(s * .004) * 1.6) * Math.cos(s * .0061 - t * .002);
      const peatWeight = (1 - sandWeight) * THREE.MathUtils.clamp(
        .24 + wetPatch * .51 + (1 - smoothstep(50, 215, riverDistance)) * .22 - Math.max(0, height - 12) * .012,
        .08, .82,
      );
      const grassWeight = Math.max(0, 1 - peatWeight - sandWeight);
      biomeWeights.push(grassWeight, peatWeight, sandWeight);
      const c = new THREE.Color('#5e7548').multiplyScalar(grassWeight)
        .add(new THREE.Color('#625a43').multiplyScalar(peatWeight))
        .add(new THREE.Color('#a19570').multiplyScalar(sandWeight));
      c.offsetHSL(0, 0, (random() - .5) * .036); colors.push(c.r, c.g, c.b);
      if (col < cols && row < rows) { const a = row * (cols + 1) + col, b = a + cols + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
    }
  }
  setRenderedTerrainHeights(mission, heights);
  const terrain = new THREE.BufferGeometry(); terrain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); terrain.setAttribute('groundBiome', new THREE.Float32BufferAttribute(biomeWeights, 3)); terrain.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); terrain.setIndex(indices); terrain.computeVertexNormals();

  // Retain the entire authored refill disc; extend irregular bays away from the operational fire area.
  const r = mission.lake.radius;
  const lakeRadius = (a: number) => r * (1.02 + .025 * (1 + Math.sin(a * 5 + .8)) + .04 * Math.pow(Math.max(0, Math.cos(a - Math.PI)), 4));
  const lakeBoundary = (scale: number) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < 96; i++) { const a = i / 96 * TAU, radius = lakeRadius(a) * scale; pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius)); }
    return new THREE.ShapeGeometry(new THREE.Shape(pts));
  };
  const shore = new THREE.Mesh(lakeBoundary(1.07), material('#85815a'));
  shore.rotation.x = -Math.PI / 2; shore.position.set(mission.lake.x, -.16, mission.lake.z); scene.add(shore);
  const lake = water.surface(lakeBoundary(1), 1, new THREE.Vector3(mission.lake.x, .025, mission.lake.z));

  // A separate river/drainage corridor to one side of the gameplay route. No invented named river.
  const ribbon = (width: number, y: number, mat: THREE.Material) => {
    const verts: number[] = [], idx: number[] = [];
    for (let i = 0; i <= 100; i++) {
      const t = coast - 120 + i / 100 * 6500, center = riverS(t), w = width * (1 + .22 * Math.sin(t * .003));
      for (const side of [-1, 1]) { const p = fromLocal(t, center + side * w); verts.push(p.x, t < coast + 75 ? -8.8 + Math.max(0, (t - coast) / 75) * 8.8 : y, p.z); }
      if (i < 100) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals(); const mesh = new THREE.Mesh(g, mat); scene.add(mesh);
  };
  ribbon(jp ? 68 : 48, -.12, material('#7e7659')); ribbon(jp ? 56 : 38, .015, water.riverMaterial);

  const isLake = (p: V) => {
    const x = p.x - mission.lake.x, z = -(p.z - mission.lake.z);
    return Math.hypot(x, z) < lakeRadius(Math.atan2(z, x)) * 1.09;
  };
  // Land uses are placed before woodland so orchards, lanes and farmyards
  // remain visible. Every solid object feeds the shared collision registry.
  const landUse = createLandUse(scene, campaign, mission, {
    fromLocal,
    terrainHeight: (x, z) => renderedTerrainHeight(campaign, mission, x, z) ?? terrainHeight(x, z),
    renderedTerrainHeight: (x, z) => renderedTerrainHeight(campaign, mission, x, z),
    coastAt,
    flightLegs,
    lake: mission.lake,
    river: { centerS: riverS, halfWidth: jp ? 68 : 48 },
    shore: mission.shore,
  });
  // One immutable footprint aligns the terrain, damaged trees and active edge.
  // Existing protected land uses and water remain breaks in the authored history.
  const burnField = createBurnField(mission, { eligible: (x, z) => {
    const point = { x, z };
    const { t, s } = local(point);
    if (t < coastAt(s) + 12 || isLake(point)) return false;
    if (Math.abs(s - riverS(t)) < (jp ? 68 : 48) + 12) return false;
    if (isBurnProtectedAirport(mission, x, z)) return false;
    return !landUse.exclusionZones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius + 8);
  } });
  const groundSurface = createGroundSurface(options.textureAssets, burnField);
  const land = new THREE.Mesh(terrain, groundSurface.material); land.receiveShadow = true; scene.add(land);
  const vegetation = createVegetation(scene, campaign, mission, {
    fromLocal,
    local,
    terrainHeight: (x, z) => renderedTerrainHeight(campaign, mission, x, z) ?? terrainHeight(x, z),
    coastAt,
    isLake,
    riverS,
    flightLegs,
    settlementExclusions: [],
    farmExclusions: landUse.exclusionZones.map(zone => ({ center: { x: zone.x, z: zone.z }, radius: zone.radius })),
    burnField,
    visualTier: options.preview || window.matchMedia('(max-width: 768px), (pointer: coarse)').matches ? 'reduced' : 'full',
  });
  const roof = material('#777d73'), wall = material('#b7aa8e');
  const solidStructures: Array<{ object: THREE.Object3D; label: string }> = [];
  if (mission.shore) {
    // Representative apron at the authored pad; dimensions informed by DGCA facilities listing.
    const apron = new THREE.Group(); apron.position.set(mission.shore.x, 0, mission.shore.z); apron.rotation.y = Math.atan2(ux, uz);
    const concrete=material('#a5aaa3'),asphalt=material('#515957'),stripe=material('#d7d6c5'),glass=material('#586e6e',.25);
    block(apron, [60, .06, 30], [0, -.05, 0], concrete);
    block(apron, [224,.06,51],[105,-.05,74],asphalt);
    // Full-width, compressed-length runway 17/35; correct facilities, authored placement.
    block(apron,[30,.06,1000],[235,-.05,380],asphalt);
    for(const z of [-60,740])block(apron,[100,.06,18],[180,-.04,z],asphalt);
    for(let z=-80;z<860;z+=55)block(apron,[.9,.02,24],[235,.003,z],stripe);
    for(const x of [220.6,249.4])block(apron,[.3,.02,1000],[x,.003,380],stripe);
    for(const z of [-95,845])for(const x of [-10,-6,-2,2,6,10])block(apron,[1.5,.02,22],[235+x,.005,z],stripe);
    for(const x of [-25,25])block(apron,[.25,.02,26],[x,.003,0],stripe);
    // Solid geometry for the shore practical; lighting consumes this same local placement.
    const apronLamp = new THREE.Group(); apronLamp.position.set(25, 0, 15);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.045, .07, 11, 8), material('#38413c', .82));
    pole.position.y = 5.5; apronLamp.add(pole);
    block(apronLamp, [.78, .35, .44], [0, 10.05, 0], material('#29322f', .7));
    apron.add(apronLamp); solidStructures.push({ object: apronLamp, label: 'shore floodlight pole' });
    // Low terminal, broad overhanging roof, shaded glazing and a compact control tower.
    const terminal = block(apron,[70,6,25],[85,3,128],wall);block(apron,[77,.4,31],[85,6.4,128],roof);
    solidStructures.push({ object: terminal, label: 'airport terminal' });
    for(let x=56;x<=114;x+=8)block(apron,[5,2.4,.18],[x,3.6,115.4],glass);
    for(const x of [48,65,85,105,122])block(apron,[.35,5,.35],[x,2.5,110],concrete);
    const tower = block(apron,[8,15,8],[141,7.5,131],concrete);block(apron,[11,3,11],[141,16,131],glass);block(apron,[13,.4,13],[141,17.7,131],roof);
    solidStructures.push({ object: tower, label: 'control tower' });
    // Service shed and parked rescue truck provide scale without obstructing the helipad.
    const shed = block(apron,[20,6,14],[-36,3,69],wall);block(apron,[22,.4,17],[-36,6.3,69],roof);
    const truck = block(apron,[3,2.8,7],[-22,1.5,53],material('#a84a32'));block(apron,[2.7,1.2,2],[-22,3.4,51],glass);
    solidStructures.push({ object: shed, label: 'airport shed' }, { object: truck, label: 'parked vehicle' });
    for(let x=10;x<=170;x+=40){block(apron,[.2,.02,35],[x,.01,71],material('#dbb95f'));block(apron,[12,.02,.2],[x,.01,55],stripe);}
    const signCanvas=document.createElement('canvas');signCanvas.width=512;signCanvas.height=64;const signContext=signCanvas.getContext('2d')!;signContext.fillStyle='#d3d2b9';signContext.fillRect(0,0,512,64);signContext.fillStyle='#354b45';signContext.font='bold 30px sans-serif';signContext.textAlign='center';signContext.fillText('RAHADI OESMAN',256,43);const signTexture=new THREE.CanvasTexture(signCanvas);signTexture.colorSpace=THREE.SRGBColorSpace;const sign=new THREE.Mesh(new THREE.PlaneGeometry(24,3),new THREE.MeshBasicMaterial({map:signTexture}));sign.position.set(85,6.8,112.3);sign.rotation.y=Math.PI;apron.add(sign);
    scene.add(apron);
  }
  const coastalDetails = createCoastalDetails(scene, campaign, mission, coastalSampler, flightLegs);
  const distantScenery = createDistantScenery(scene, campaign, mission, { preview: options.preview });
  const treeColliders: TreeCollider[] = [
    ...vegetation.treeColliders,
    ...landUse.treeColliders,
    ...coastalDetails.treeColliders,
  ];
  setTreeColliders(mission, treeColliders);
  const structureColliders: StructureCollider[] = solidStructures.map(({ object, label }) => {
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    return {
      x: (bounds.min.x + bounds.max.x) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
      halfWidth: (bounds.max.x - bounds.min.x) / 2,
      halfLength: (bounds.max.z - bounds.min.z) / 2,
      bottom: bounds.min.y,
      top: bounds.max.y,
      label,
    };
  });
  structureColliders.push(...landUse.structureColliders, ...coastalDetails.structureColliders);
  setStructureColliders(mission, structureColliders);
  let detail: 'high' | 'low' = 'high';
  return {
    setQuality(profile: RenderQualityProfile) {
      detail = profile.detail;
      water.setQuality({ reflectionSize: profile.reflectionSize, reflectionIntervalMs: profile.reflectionIntervalMs, reflections: profile.reflections && !options.preview });
      atmosphere.setQuality(profile.detail);
    },
    update(time: number, camera?: THREE.Vector3, state?: SimState, nightStrength = 0) {
      groundSurface.update(state);
      water.update(time, state);
      atmosphere.update(time, camera, state);
      coastalDetails.update(time, nightStrength);
      if (camera) vegetation.update(camera, detail);
    },
    dispose() { distantScenery.dispose(); coastalDetails.dispose(); landUse.dispose(); vegetation.dispose(); water.dispose(); groundSurface.dispose(); },
    terrainHeight, burnField, lake, shore, boats: coastalDetails.boats, coastalStats: coastalDetails.stats,
    vegetationStats: vegetation.stats, landUseStats: landUse.stats,
    coastalLightingAnchor: coastalDetails.lightingAnchor, route: { ux, uz, sx, sz, routeLength },
  };
}
