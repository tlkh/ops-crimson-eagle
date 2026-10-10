import * as THREE from 'three';
import type { Mission, SimState } from '../types';
import { createBurnField, type BurnField } from './burnField';
import { evaluateTimeOfDay } from './timeOfDay';

const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Four original turbulent flame masks, baked once rather than raymarched. */
function flameTexture() {
  const width = 256, height = 512, tileWidth = 128, tileHeight = 256;
  const pixels = new Uint8Array(width * height * 4);
  for (let variant = 0; variant < 4; variant++) {
    for (let y = 0; y < tileHeight; y++) {
      for (let x = 0; x < tileWidth; x++) {
        const u = x / (tileWidth - 1), v = y / (tileHeight - 1);
        const warp = (gridNoise(u * 4, v * 8, variant + 71) - .5) * .35;
        const turbulence = gridNoise(u * 13 + warp, v * 17, variant + 7) * .62
          + gridNoise(u * 29, v * 35, variant + 29) * .38;
        const taper = .025 + Math.pow(1 - v, .65) * .36;
        const axis = .5 + Math.sin(v * 13 + variant * 2.1) * v * .11 + warp * v;
        const tongue = Math.max(0, 1 - Math.abs(u - axis) / taper);
        const body = tongue * (.75 + turbulence * .45) - v * .5;
        const edge = clamp((body - .10 + (turbulence - .5) * .45) * 2.5, 0, 1);
        const border = Math.min(u, 1 - u, v, 1 - v);
        const opacity = edge * edge * (3 - 2 * edge) * clamp(border * 24, 0, 1);
        const core = clamp(body * 1.15, 0, 1);
        const pixel = ((Math.floor(variant / 2) * tileHeight + y) * width + (variant % 2) * tileWidth + x) * 4;
        pixels[pixel] = 255;
        pixels[pixel + 1] = Math.round(70 + 177 * core);
        pixels[pixel + 2] = Math.round(12 + 122 * core * core * core);
        pixels[pixel + 3] = Math.round(opacity * 255);
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function gridHash(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function gridNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - Math.floor(x), fy = y - Math.floor(y);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = gridHash(ix, iy, seed), b = gridHash(ix + 1, iy, seed);
  const c = gridHash(ix, iy + 1, seed), d = gridHash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/** Four procedural, internally textured puffs reduce the repeated-stamp look. */
function smokeTexture(seed: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const size = 128;
  for (let variant = 0; variant < 4; variant++) {
    const image = ctx.createImageData(size, size);
    const centerX = .47 + (gridHash(variant, 1, seed) - .5) * .14;
    const centerY = .49 + (gridHash(variant, 3, seed) - .5) * .12;
    const stretchX = .35 + gridHash(variant, 5, seed) * .10;
    const stretchY = .36 + gridHash(variant, 7, seed) * .10;
    // Keep a transparent gutter inside every cell so linear filtering cannot
    // expose a neighboring puff when an instance reaches its UV edge.
    const padding = .08;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const tileU = px / (size - 1), tileV = py / (size - 1);
        if (tileU <= padding || tileU >= 1 - padding || tileV <= padding || tileV >= 1 - padding) continue;
        const u = (tileU - padding) / (1 - padding * 2), v = (tileV - padding) / (1 - padding * 2);
        const broad = gridNoise(u * 3.4, v * 3.4, seed + variant * 71 + 1);
        const medium = gridNoise(u * 8.5, v * 8.5, seed + variant * 71 + 7);
        const fine = gridNoise(u * 19, v * 19, seed + variant * 71 + 19);
        const detail = gridNoise(u * 40, v * 40, seed + variant * 71 + 31);
        const field = broad * .5 + medium * .27 + fine * .15 + detail * .08;
        const radius = Math.hypot((u - centerX) / stretchX, (v - centerY) / stretchY);
        const envelope = Math.max(0, 1 - radius);
        const mass = envelope * (.78 + (field - .48) * .92);
        const edge = clamp((mass - .1) / .34, 0, 1);
        const softEdge = edge * edge * (3 - 2 * edge);
        const border = Math.min(u, 1 - u, v, 1 - v);
        const borderFade = clamp((border - .015) / .075, 0, 1);
        const alpha = softEdge * borderFade * (1 - clamp((v - .91) * 3, 0, .22));
        const pixel = (py * size + px) * 4;
        const soot = Math.round(224 + field * 31);
        image.data[pixel] = soot;
        image.data[pixel + 1] = soot;
        image.data[pixel + 2] = soot;
        image.data[pixel + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, (variant % 2) * size, Math.floor(variant / 2) * size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function emberTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  glow.addColorStop(0, 'rgba(255,246,184,1)');
  glow.addColorStop(.18, 'rgba(255,166,52,.9)');
  glow.addColorStop(.55, 'rgba(240,70,16,.34)');
  glow.addColorStop(1, 'rgba(255,55,8,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type ParticleLighting = {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  ambientColor: THREE.Color;
  sunIntensity: { value: number };
};

function makeInstancedParticles(
  texture: THREE.Texture,
  count: number,
  blending: THREE.Blending = THREE.NormalBlending,
  atlasColumns = 1,
  lighting?: ParticleLighting,
) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  opacity.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceOpacity', opacity);
  if (atlasColumns > 1) {
    const offsets = new Float32Array(count * 2);
    const tileInset = .008;
    for (let i = 0; i < count; i++) {
      const tile = i % (atlasColumns * atlasColumns);
      const column = tile % atlasColumns, row = Math.floor(tile / atlasColumns);
      offsets[i * 2] = column / atlasColumns + tileInset;
      offsets[i * 2 + 1] = 1 - (row + 1) / atlasColumns + tileInset;
    }
    const atlasOffset = new THREE.InstancedBufferAttribute(offsets, 2);
    atlasOffset.setUsage(THREE.StaticDrawUsage);
    geometry.setAttribute('instanceAtlasOffset', atlasOffset);
  }
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute float instanceOpacity; varying float vInstanceOpacity;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
    if (atlasColumns > 1) {
      shader.vertexShader = `attribute vec2 instanceAtlasOffset;\n${shader.vertexShader}`
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = uv * ${1 / atlasColumns - .016} + instanceAtlasOffset;`);
    }
    if (lighting) {
      shader.uniforms.fireSunDirection = { value: lighting.sunDirection };
      shader.uniforms.fireSunColor = { value: lighting.sunColor };
      shader.uniforms.fireAmbientColor = { value: lighting.ambientColor };
      shader.uniforms.fireSunIntensity = lighting.sunIntensity;
      shader.vertexShader = `varying vec3 vParticleWorldPosition;\n${shader.vertexShader}`
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          // MeshBasicMaterial does not always enable Three's worldPosition
          // chunk (for example without shadow or environment defines at night).
          vec4 particleWorldPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            particleWorldPosition = instanceMatrix * particleWorldPosition;
          #endif
          vParticleWorldPosition = (modelMatrix * particleWorldPosition).xyz;`);
      shader.fragmentShader = `
        uniform vec3 fireSunDirection;
        uniform vec3 fireSunColor;
        uniform vec3 fireAmbientColor;
        uniform float fireSunIntensity;
        varying vec3 vParticleWorldPosition;
      ` + shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 particleNormal = normalize(cross(dFdx(vParticleWorldPosition), dFdy(vParticleWorldPosition)));
         float sunFacing = abs(dot(particleNormal, normalize(fireSunDirection)));
         float particleLight = 0.72 + 0.28 * sunFacing * clamp(fireSunIntensity, 0.0, 1.0);
         vec3 smokeTint = mix(vec3(0.65, 0.68, 0.72), fireAmbientColor, 0.46);
         smokeTint = mix(smokeTint, fireSunColor, 0.10 * clamp(fireSunIntensity, 0.0, 1.0));
         diffuseColor.rgb *= smokeTint * particleLight;`,
      );
    }
    shader.fragmentShader = `varying float vInstanceOpacity;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vInstanceOpacity;');
  };
  material.customProgramCacheKey = () => `instanced-particle-opacity-atlas-${atlasColumns}-light-${Boolean(lighting)}-v3`;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  return { mesh, opacity };
}

export type FireSite = { x: number; z: number; severity: number; age: number; activity: number };
type WeightedFireSite = FireSite & { index: number; weight: number; radial: number };
type Flame = FireSite & { y: number; width: number; height: number; phase: number; color: THREE.Color };
type SmokeSource = FireSite & { y: number; residualOnly: boolean; residual: number };
type SmokePuff = { source: number; phase: number; size: number; height: number; tint: THREE.Color; low?: boolean };
type Ember = { x: number; z: number; y: number; phase: number; size: number; activity: number };
type SteamPuff = { x: number; z: number; y: number; phase: number; size: number; tint: THREE.Color; eligible: boolean };

const FIELD_SAMPLE_LIMIT = 96;

function fieldEligible(burnField: BurnField, x: number, z: number): boolean {
  const { minX, maxX, minZ, maxZ } = burnField.bounds;
  const size = Math.floor(burnField.size);
  if (size < 1 || x < minX || x > maxX || z < minZ || z > maxZ || burnField.data.length < size * size * 4) return false;
  const col = Math.round((x - minX) / (maxX - minX) * (size - 1));
  const row = Math.round((z - minZ) / (maxZ - minZ) * (size - 1));
  return burnField.data[(row * size + col) * 4 + 3] > 127;
}

function fieldSites(mission: Mission, burnField: BurnField): WeightedFireSite[] {
  const radius = Math.max(1, mission.fire.radius);
  const resolution = Math.max(8, Math.min(FIELD_SAMPLE_LIMIT, Math.floor(burnField.size)));
  const bounds = burnField.bounds;
  const candidates: WeightedFireSite[] = [];
  for (let row = 0; row < resolution; row++) {
    const z = bounds.minZ + (row + .5) / resolution * (bounds.maxZ - bounds.minZ);
    for (let col = 0; col < resolution; col++) {
      const x = bounds.minX + (col + .5) / resolution * (bounds.maxX - bounds.minX);
      const radial = Math.hypot(x - mission.fire.x, z - mission.fire.z) / radius;
      if (radial > .94) continue;
      if (!fieldEligible(burnField, x, z)) continue;
      const sample = burnField.sample(x, z);
      const activity = clamp(Number.isFinite(sample.activity) ? sample.activity : 0, 0, 1);
      if (activity < .018) continue;
      const severity = clamp(Number.isFinite(sample.severity) ? sample.severity : 0, 0, 1);
      const age = clamp(Number.isFinite(sample.age) ? sample.age : 0, 0, 1);
      const outerBias = .82 + .18 * clamp((radial - .38) / .5, 0, 1);
      const weight = activity * (.28 + severity * .72) * outerBias;
      if (weight > 0) candidates.push({ index: row * resolution + col, x, z, severity, age, activity, radial, weight });
    }
  }
  return candidates;
}

function weightedPick(candidates: readonly WeightedFireSite[], count: number, rand: () => number): WeightedFireSite[] {
  const pool = candidates.slice();
  const selected: WeightedFireSite[] = [];
  const limit = Math.min(Math.max(0, Math.floor(count)), pool.length);
  for (let draw = 0; draw < limit; draw++) {
    let totalWeight = 0;
    for (const candidate of pool) totalWeight += candidate.weight;
    if (!(totalWeight > 0) || !Number.isFinite(totalWeight)) break;
    let cursor = rand() * totalWeight;
    let selectedIndex = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      cursor -= pool[i].weight;
      if (cursor <= 0) {
        selectedIndex = i;
        break;
      }
    }
    selected.push(pool[selectedIndex]);
    pool.splice(selectedIndex, 1);
  }
  return selected;
}

function interleaveSites(front: WeightedFireSite[], interior: WeightedFireSite[]): FireSite[] {
  const sites: FireSite[] = [];
  let frontIndex = 0, interiorIndex = 0;
  while (frontIndex < front.length || interiorIndex < interior.length) {
    for (let i = 0; i < 3 && frontIndex < front.length; i++) sites.push(front[frontIndex++]);
    if (interiorIndex < interior.length) sites.push(interior[interiorIndex++]);
  }
  return sites;
}

/** Deterministic active flame locations weighted by authored burn activity and severity. */
export function selectFireSites(mission: Mission, burnField: BurnField, count: number, seed = mission.seed): FireSite[] {
  const candidates = fieldSites(mission, burnField);
  const interiorCandidates = candidates.filter(candidate => candidate.radial <= .52);
  const frontCandidates = candidates.filter(candidate => candidate.radial > .52);
  const interiorCount = Math.min(interiorCandidates.length, Math.round(count * .25));
  const frontCount = Math.min(frontCandidates.length, count - interiorCount);
  const front = weightedPick(frontCandidates, frontCount, random(seed ^ 0x41f3));
  const interior = weightedPick(interiorCandidates, interiorCount, random(seed ^ 0x1729));
  const selected = interleaveSites(front, interior);
  if (selected.length < count) {
    const used = new Set([...front, ...interior].map(site => site.index));
    const remaining = candidates.filter(site => !used.has(site.index));
    selected.push(...weightedPick(remaining, count - selected.length, random(seed ^ 0x5a17)));
  }
  return selected;
}

/** Old, inactive fire scars can feed a few low residual smoke puffs only. */
export function selectResidualSmokeSites(mission: Mission, burnField: BurnField, count: number, seed = mission.seed): FireSite[] {
  const radius = Math.max(1, mission.fire.radius);
  const resolution = Math.max(8, Math.min(FIELD_SAMPLE_LIMIT, Math.floor(burnField.size)));
  const { minX, maxX, minZ, maxZ } = burnField.bounds;
  const candidates: WeightedFireSite[] = [];
  for (let row = 0; row < resolution; row++) {
    const z = minZ + (row + .5) / resolution * (maxZ - minZ);
    for (let col = 0; col < resolution; col++) {
      const x = minX + (col + .5) / resolution * (maxX - minX);
      const radial = Math.hypot(x - mission.fire.x, z - mission.fire.z) / radius;
      if (radial <= .96) continue;
      if (!fieldEligible(burnField, x, z)) continue;
      const sample = burnField.sample(x, z);
      const severity = clamp(Number.isFinite(sample.severity) ? sample.severity : 0, 0, 1);
      const age = clamp(Number.isFinite(sample.age) ? sample.age : 0, 0, 1);
      const activity = clamp(Number.isFinite(sample.activity) ? sample.activity : 0, 0, 1);
      if (age < .56 || severity < .12 || activity > .025) continue;
      const tailBias = .35 + .65 * clamp((radial - .96) / 1.25, 0, 1);
      const weight = severity * age * age * tailBias;
      if (weight > 0) candidates.push({ index: row * resolution + col, x, z, severity, age, activity, radial, weight });
    }
  }
  return weightedPick(candidates, count, random(seed ^ 0x723b)).map(({ x, z, severity, age, activity }) => ({ x, z, severity, age, activity }));
}

export function createFire(
  scene: THREE.Scene,
  mission: Mission,
  terrainHeight: (x: number, z: number) => number,
  burnField: BurnField = createBurnField(mission),
) {
  const root = new THREE.Group();
  const rand = random(mission.seed + 717);
  const radius = clamp(mission.fire.radius, 40, 5500);

  const flames: Flame[] = [];
  const flameCount = Math.round(clamp(radius / 2.4, 30, 60));
  const flameSites = selectFireSites(mission, burnField, flameCount, mission.seed + 811);
  for (let i = 0; i < flameCount; i++) {
    const site = flameSites[i] ?? { x: mission.fire.x, z: mission.fire.z, severity: 0, age: 0, activity: 0 };
    flames.push({
      ...site,
      y: terrainHeight(site.x, site.z) + .7,
      width: 4 + rand() * 6,
      height: 3 + rand() * 7,
      phase: rand() * TAU,
      color: new THREE.Color().setHSL(.10 + rand() * .015, .08, .88),
    });
  }

  const smokeSourceCount = Math.max(6, Math.round(flameCount / 3));
  const desiredResidualSources = Math.max(1, Math.floor(smokeSourceCount * .2));
  const residualSites = selectResidualSmokeSites(mission, burnField, desiredResidualSources, mission.seed + 1103);
  const activeSites = selectFireSites(
    mission,
    burnField,
    smokeSourceCount - residualSites.length,
    mission.seed + 1171,
  );
  const sourceSites: Array<FireSite & { residualOnly: boolean }> = [];
  const activeSiteCount = Math.max(0, smokeSourceCount - residualSites.length);
  for (let i = 0; i < Math.max(activeSites.length, residualSites.length); i++) {
    if (activeSites[i] && i < activeSiteCount) sourceSites.push({ ...activeSites[i], residualOnly: false });
    if (residualSites[i]) sourceSites.push({ ...residualSites[i], residualOnly: true });
  }
  while (sourceSites.length < smokeSourceCount) {
    const site = flameSites[sourceSites.length % Math.max(1, flameSites.length)]
      ?? { x: mission.fire.x, z: mission.fire.z, severity: 0, age: 0, activity: 0 };
    sourceSites.push({ ...site, residualOnly: false });
  }
  const smokeSources: SmokeSource[] = sourceSites.slice(0, smokeSourceCount).map(source => ({
    ...source,
    y: terrainHeight(source.x, source.z) + 2,
    residual: clamp(source.severity * (.24 + source.age * .48), 0, 1),
  }));
  const smoke: SmokePuff[] = [];
  for (let source = 0; source < smokeSourceCount; source++) {
    for (let puff = 0; puff < 4; puff++) {
      const shade = .055 + rand() * .065;
      smoke.push({
        source,
        phase: puff / 4 + rand() * .08,
        size: 19 + rand() * 25,
        height: 90 + rand() * 115,
        tint: new THREE.Color(shade, shade * (mission.peat ? 1.01 : .98), shade * .91),
      });
    }
    smoke.push({ source, phase: rand(), size: 28 + rand() * 19, height: 14 + rand() * 9, tint: new THREE.Color(.10, .105, .09), low: true });
  }

  const emberSites = selectFireSites(mission, burnField, 20, mission.seed + 1207);
  const embers: Ember[] = Array.from({ length: 20 }, (_, index) => {
    const site = emberSites[index] ?? { x: mission.fire.x, z: mission.fire.z, severity: 0, age: 0, activity: 0 };
    return { x: site.x, z: site.z, y: terrainHeight(site.x, site.z) + 1.5, phase: rand(), size: .7 + rand() * 1.1, activity: site.activity };
  });
  const steamSites = selectFireSites(mission, burnField, 12, mission.seed + 1231);
  const steam: SteamPuff[] = Array.from({ length: 12 }, (_, index) => {
    const site = steamSites[index] ?? { x: mission.fire.x, z: mission.fire.z };
    const shade = .72 + rand() * .16;
    return {
      x: site.x,
      z: site.z,
      y: terrainHeight(site.x, site.z) + 1.5,
      phase: index / 12 + rand() * .12,
      size: 18 + rand() * 25,
      tint: new THREE.Color(shade, shade, shade * .96),
      eligible: Boolean(steamSites[index]),
    };
  });

  const particleLighting: ParticleLighting = {
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(1, .91, .73),
    ambientColor: new THREE.Color(.77, .84, .88),
    sunIntensity: { value: 1 },
  };
  const flameMap = flameTexture();
  const smokeMap = smokeTexture(mission.seed + 1201);
  const emberMap = emberTexture();
  const flameParticles = makeInstancedParticles(flameMap, flames.length, THREE.AdditiveBlending, 2);
  const smokeParticles = makeInstancedParticles(smokeMap, smoke.length, THREE.NormalBlending, 2, particleLighting);
  const emberParticles = makeInstancedParticles(emberMap, embers.length, THREE.AdditiveBlending);
  const steamParticles = makeInstancedParticles(smokeMap, steam.length, THREE.NormalBlending, 2, particleLighting);
  root.add(flameParticles.mesh, smokeParticles.mesh, emberParticles.mesh, steamParticles.mesh);
  const dummy = new THREE.Object3D();
  const fallbackQuaternion = new THREE.Quaternion();
  const color = new THREE.Color();

  for (let i = 0; i < flames.length; i++) flameParticles.mesh.setColorAt(i, flames[i].color);
  for (let i = 0; i < smoke.length; i++) smokeParticles.mesh.setColorAt(i, smoke[i].tint);
  for (let i = 0; i < embers.length; i++) emberParticles.mesh.setColorAt(i, color.setHSL(.055 + rand() * .045, 1, .62));
  for (let i = 0; i < steam.length; i++) steamParticles.mesh.setColorAt(i, steam[i].tint);

  scene.add(root);
  let lastHeat: number | undefined;
  let lastTime = 0;
  let steamStrength = 0;
  let activeFlameCount = flames.length;
  let activeSmokeCount = smoke.length;
  let activeEmberCount = embers.length;
  let activeSteamCount = steam.length;
  const setQuality = (quality: 'high' | 'low') => {
    const scale = quality === 'high' ? 1 : .5;
    activeFlameCount = Math.max(1, Math.floor(flames.length * scale));
    activeSmokeCount = Math.max(1, Math.floor(smoke.length * scale));
    activeEmberCount = Math.max(1, Math.floor(embers.length * scale));
    activeSteamCount = Math.max(1, Math.floor(steam.length * scale));
    flameParticles.mesh.count = activeFlameCount;
    smokeParticles.mesh.count = activeSmokeCount;
    emberParticles.mesh.count = activeEmberCount;
    steamParticles.mesh.count = activeSteamCount;
  };

  return {
    root,
    setQuality,
    /** Camera is optional for older callers; passing it keeps all pooled quads camera-facing. */
    update(timeSec: number, heat: number, burning: boolean, wind: { x: number; z: number }, camera?: THREE.Camera, state?: SimState) {
      const factor = clamp(heat / 100, 0, 1);
      const fireActive = state
        ? state.fireState === 'burning' || state.fireState === 'surface_suppressed' || state.fireState === 'being_secured'
        : burning;
      const activity = fireActive ? Math.max(.15, factor) : 0;
      const peatResidual = mission.peat ? clamp((state?.peatHeat ?? 0) / 100 * .32, 0, .32) : 0;
      const residual = fireActive
        ? activity
        : Math.max(clamp(factor * (mission.peat ? .16 : .11), 0, mission.peat ? .18 : .12), peatResidual);
      const delta = Math.max(0, Math.min(.5, timeSec - lastTime));
      const surfaceHeat = state?.fireHeat ?? heat;
      const cooling = Math.max(0, (lastHeat ?? surfaceHeat) - surfaceHeat);
      steamStrength = Math.max(steamStrength * Math.exp(-delta * .46), cooling > .005 ? clamp(cooling * 3, .08, .84) : 0);
      lastHeat = surfaceHeat;
      lastTime = timeSec;
      const facing = camera?.quaternion ?? fallbackQuaternion;
      const timeOfDay = evaluateTimeOfDay(mission, timeSec);
      particleLighting.sunDirection.set(...timeOfDay.sunDirection);
      particleLighting.sunColor.setRGB(...timeOfDay.sunColor);
      particleLighting.ambientColor.setRGB(...timeOfDay.ambientColor);
      particleLighting.sunIntensity.value = timeOfDay.sunIntensity / 3.5;
      const nightGlow = .86 + timeOfDay.nightStrength * .34;

      for (let i = 0; i < activeFlameCount; i++) {
        const flame = flames[i];
        const localActivity = flame.activity > 0 ? activity * (.2 + .8 * flame.activity) : 0;
        const pulse = .86 + .13 * Math.sin(timeSec * 5.7 + flame.phase) + .08 * Math.sin(timeSec * 9.9 + flame.phase * 2.3);
        const stretch = .55 + localActivity * .72;
        dummy.position.set(flame.x + Math.sin(timeSec * 2.1 + flame.phase) * 1.8, flame.y + flame.height * (.45 + localActivity * .78) * pulse * .5, flame.z);
        dummy.quaternion.copy(facing);
        dummy.scale.set(flame.width * stretch * pulse, flame.height * (.45 + localActivity * .78) * pulse, 1);
        dummy.updateMatrix();
        flameParticles.mesh.setMatrixAt(i, dummy.matrix);
        flameParticles.opacity.setX(i, localActivity * .9 * nightGlow);
      }
      flameParticles.mesh.instanceMatrix.needsUpdate = true;
      flameParticles.opacity.needsUpdate = true;

      for (let i = 0; i < activeSmokeCount; i++) {
        const puff = smoke[i];
        const source = smokeSources[puff.source];
        const life = (timeSec * (puff.low ? .055 : .065) + puff.phase) % 1;
        const spread = 5 + life * 28;
        const swirl = Math.sin(timeSec * 1.35 + puff.phase * TAU) * spread * .52;
        const driftX = wind.x * life * 25 - wind.z * life * 5 + swirl;
        const driftZ = wind.z * life * 25 + wind.x * life * 5 + Math.cos(timeSec * 1.1 + puff.phase * TAU) * spread * .42;
        const puffyScale = .65 + life * 1.75;
        dummy.position.set(source.x + driftX, source.y + (puff.low ? 3 : 10) + life * puff.height, source.z + driftZ);
        dummy.quaternion.copy(facing);
        dummy.scale.set(puff.size * puffyScale * 1.18, puff.size * puffyScale, 1);
        dummy.updateMatrix();
        smokeParticles.mesh.setMatrixAt(i, dummy.matrix);
        const sourceActivity = activity * source.activity;
        const sourceResidual = residual * source.residual * (fireActive ? .12 : 1);
        const smokeAmount = source.residualOnly
          ? (puff.low ? sourceResidual : 0)
          : puff.low
            ? Math.max(sourceActivity * .26, sourceResidual * .22)
            : sourceActivity * .62;
        smokeParticles.opacity.setX(i, smokeAmount * Math.pow(Math.sin(Math.PI * life), .72));
      }
      smokeParticles.mesh.instanceMatrix.needsUpdate = true;
      smokeParticles.opacity.needsUpdate = true;

      for (let i = 0; i < activeEmberCount; i++) {
        const ember = embers[i];
        const life = (timeSec * .24 + ember.phase) % 1;
        const flicker = .55 + .45 * Math.sin(timeSec * 15 + ember.phase * TAU) ** 2;
        dummy.position.set(ember.x + wind.x * life * 5, ember.y + life * (9 + ember.size * 2), ember.z + wind.z * life * 5);
        dummy.quaternion.copy(facing);
        dummy.scale.setScalar(ember.size * (.7 + life * .4));
        dummy.updateMatrix();
        emberParticles.mesh.setMatrixAt(i, dummy.matrix);
        const emberActivity = ember.activity > 0 ? activity * (.2 + .8 * ember.activity) : 0;
        emberParticles.opacity.setX(i, emberActivity * .66 * nightGlow * (1 - life * .58) * flicker);
      }
      emberParticles.mesh.instanceMatrix.needsUpdate = true;
      emberParticles.opacity.needsUpdate = true;

      for (let i = 0; i < activeSteamCount; i++) {
        const puff = steam[i];
        const life = (timeSec * .18 + puff.phase) % 1;
        const width = puff.size * (.7 + life * 1.6);
        dummy.position.set(puff.x + wind.x * life * 7, puff.y + 4 + life * 27, puff.z + wind.z * life * 7);
        dummy.quaternion.copy(facing);
        dummy.scale.set(width, width * (1 + life * .18), 1);
        dummy.updateMatrix();
        steamParticles.mesh.setMatrixAt(i, dummy.matrix);
        steamParticles.opacity.setX(i, puff.eligible ? steamStrength * .52 * Math.sin(Math.PI * life) : 0);
      }
      steamParticles.mesh.instanceMatrix.needsUpdate = true;
      steamParticles.opacity.needsUpdate = true;
    },
    dispose() {
      scene.remove(root);
      root.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
      flameMap.dispose();
      smokeMap.dispose();
      emberMap.dispose();
    },
  };
}
