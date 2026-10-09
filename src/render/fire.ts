import * as THREE from 'three';
import type { Mission } from '../types';

const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function flameTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(32, 94, 3, 32, 76, 54);
  glow.addColorStop(0, 'rgba(255,235,141,.88)');
  glow.addColorStop(.25, 'rgba(255,137,34,.7)');
  glow.addColorStop(.7, 'rgba(197,53,13,.3)');
  glow.addColorStop(1, 'rgba(155,30,9,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.moveTo(4, 127);
  ctx.quadraticCurveTo(12, 88, 17, 79);
  ctx.quadraticCurveTo(9, 59, 26, 39);
  ctx.quadraticCurveTo(27, 55, 35, 62);
  ctx.quadraticCurveTo(43, 38, 36, 12);
  ctx.quadraticCurveTo(64, 55, 50, 83);
  ctx.quadraticCurveTo(63, 101, 62, 127);
  ctx.closePath();
  ctx.fill();
  const core = ctx.createLinearGradient(0, 125, 0, 53);
  core.addColorStop(0, 'rgba(255,237,156,.8)');
  core.addColorStop(.55, 'rgba(255,165,47,.65)');
  core.addColorStop(1, 'rgba(255,111,19,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.moveTo(20, 127);
  ctx.quadraticCurveTo(13, 96, 31, 73);
  ctx.quadraticCurveTo(31, 94, 44, 127);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** White alpha silhouettes let instance colors describe soot, warm haze, and steam. */
function smokeTexture(seed: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const rand = random(seed);
  for (let i = 0; i < 13; i++) {
    const x = 28 + rand() * 72;
    const y = 24 + rand() * 80;
    const rx = 17 + rand() * 27;
    const ry = 17 + rand() * 28;
    const alpha = .12 + rand() * .11;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, .025, 0, 0, 1);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(.48, `rgba(255,255,255,${alpha * .82})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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

function makeInstancedParticles(texture: THREE.Texture, count: number, blending: THREE.Blending = THREE.NormalBlending) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  opacity.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceOpacity', opacity);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute float instanceOpacity; varying float vInstanceOpacity;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
    shader.fragmentShader = `varying float vInstanceOpacity;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vInstanceOpacity;');
  };
  material.customProgramCacheKey = () => 'instanced-particle-opacity-v1';
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  return { mesh, opacity };
}

function burnMark(mission: Mission, terrainHeight: (x: number, z: number) => number, rand: () => number) {
  const radius = clamp(mission.fire.radius, 40, 5500);
  const segments = 40;
  const rings = [0, .23, .56, .82, 1.08];
  const positions: number[] = [];
  const colors: number[] = [];
  const opacity: number[] = [];
  const indices: number[] = [];
  const jitter = Array.from({ length: segments }, () => .88 + rand() * .23);
  const palette = ['#2b3029', '#303329', '#38392d', '#414b39', '#566249'].map(c => new THREE.Color(c));
  for (let ring = 0; ring < rings.length; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment / segments * TAU;
      const r = radius * rings[ring] * jitter[segment];
      const x = mission.fire.x + Math.cos(angle) * r;
      const z = mission.fire.z + Math.sin(angle) * r;
      positions.push(x, terrainHeight(x, z) + .28, z);
      const color = palette[ring].clone().multiplyScalar(.86 + rand() * .27);
      colors.push(color.r, color.g, color.b);
      opacity.push([.94, 1, .94, .75, 0][ring]);
      if (ring < rings.length - 1) {
        const next = ring * segments + (segment + 1) % segments;
        const outer = (ring + 1) * segments + segment;
        const outerNext = (ring + 1) * segments + (segment + 1) % segments;
        indices.push(ring * segments + segment, outer, next, next, outer, outerNext);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('burnOpacity', new THREE.Float32BufferAttribute(opacity, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: .9, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float burnOpacity; varying float burnAlpha; varying vec2 burnPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nburnAlpha=burnOpacity; burnPosition=position.xz;');
    shader.fragmentShader = 'varying float burnAlpha; varying vec2 burnPosition;\nfloat burnHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat burnNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(burnHash(i),burnHash(i+vec2(1,0)),f.x),mix(burnHash(i+vec2(0,1)),burnHash(i+vec2(1,1)),f.x),f.y); }\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat grain=.72+.28*burnNoise(burnPosition*.36); diffuseColor.rgb*=grain; diffuseColor.a*=burnAlpha*(.6+.4*burnNoise(burnPosition*.11));');
  };
  material.customProgramCacheKey = () => 'feathered-burn-scar-v1';
  return new THREE.Mesh(geometry, material);
}

type Flame = { x: number; z: number; y: number; width: number; height: number; phase: number; color: THREE.Color };
type SmokePuff = { source: number; phase: number; size: number; height: number; tint: THREE.Color; low?: boolean };
type Ember = { x: number; z: number; y: number; phase: number; size: number };
type SteamPuff = { x: number; z: number; y: number; phase: number; size: number; tint: THREE.Color };

export function createFire(scene: THREE.Scene, mission: Mission, terrainHeight: (x: number, z: number) => number) {
  const root = new THREE.Group();
  const rand = random(mission.seed + 717);
  const radius = clamp(mission.fire.radius, 40, 5500);
  root.add(burnMark(mission, terrainHeight, rand));

  const flames: Flame[] = [];
  const flameCount = Math.round(clamp(radius / 2.4, 30, 60));
  for (let i = 0; i < flameCount; i++) {
    const angle = rand() * TAU;
    const distance = Math.sqrt(rand()) * radius * .78;
    const x = mission.fire.x + Math.cos(angle) * distance;
    const z = mission.fire.z + Math.sin(angle) * distance;
    flames.push({
      x,
      z,
      y: terrainHeight(x, z) + .7,
      width: 3 + rand() * 6,
      height: 5 + rand() * 14,
      phase: rand() * TAU,
      color: new THREE.Color().setHSL(.035 + rand() * .055, .95, .55),
    });
  }

  const smokeSourceCount = Math.max(6, Math.round(flameCount / 3));
  const smokeSources = Array.from({ length: smokeSourceCount }, () => {
    const angle = rand() * TAU;
    const distance = Math.sqrt(rand()) * radius * .68;
    const x = mission.fire.x + Math.cos(angle) * distance;
    const z = mission.fire.z + Math.sin(angle) * distance;
    return { x, z, y: terrainHeight(x, z) + 2 };
  });
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

  const embers: Ember[] = Array.from({ length: 20 }, () => {
    const angle = rand() * TAU;
    const distance = Math.sqrt(rand()) * radius * .73;
    const x = mission.fire.x + Math.cos(angle) * distance;
    const z = mission.fire.z + Math.sin(angle) * distance;
    return { x, z, y: terrainHeight(x, z) + 1.5, phase: rand(), size: 3 + rand() * 4 };
  });
  const steam: SteamPuff[] = Array.from({ length: 12 }, (_, index) => {
    const angle = index / 12 * TAU + rand() * .25;
    const distance = Math.sqrt(rand()) * radius * .65;
    const shade = .72 + rand() * .16;
    const x = mission.fire.x + Math.cos(angle) * distance;
    const z = mission.fire.z + Math.sin(angle) * distance;
    return { x, z, y: terrainHeight(x, z) + 1.5, phase: index / 12 + rand() * .12, size: 18 + rand() * 25, tint: new THREE.Color(shade, shade, shade * .96) };
  });

  const flameParticles = makeInstancedParticles(flameTexture(), flames.length, THREE.AdditiveBlending);
  const smokeMap = smokeTexture(mission.seed + 1201);
  const smokeParticles = makeInstancedParticles(smokeMap, smoke.length);
  const emberParticles = makeInstancedParticles(emberTexture(), embers.length, THREE.AdditiveBlending);
  const steamParticles = makeInstancedParticles(smokeMap, steam.length);
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

  return {
    root,
    /** Camera is optional for older callers; passing it keeps all pooled quads camera-facing. */
    update(timeSec: number, heat: number, burning: boolean, wind: { x: number; z: number }, camera?: THREE.Camera) {
      const factor = clamp(heat / 100, 0, 1);
      const activity = burning ? Math.max(.18, factor) : 0;
      const residual = burning ? activity : clamp(factor * .11, 0, .12);
      const delta = Math.max(0, Math.min(.5, timeSec - lastTime));
      const cooling = Math.max(0, (lastHeat ?? heat) - heat);
      steamStrength = Math.max(steamStrength * Math.exp(-delta * .46), cooling > .005 ? clamp(cooling * 3, .08, .84) : 0);
      lastHeat = heat;
      lastTime = timeSec;
      const facing = camera?.quaternion ?? fallbackQuaternion;

      for (let i = 0; i < flames.length; i++) {
        const flame = flames[i];
        const pulse = .86 + .13 * Math.sin(timeSec * 5.7 + flame.phase) + .08 * Math.sin(timeSec * 9.9 + flame.phase * 2.3);
        const stretch = .55 + activity * .72;
        dummy.position.set(flame.x + Math.sin(timeSec * 2.1 + flame.phase) * 1.8, flame.y + flame.height * (.45 + activity * .78) * pulse * .5, flame.z);
        dummy.quaternion.copy(facing);
        dummy.scale.set(flame.width * stretch * pulse, flame.height * (.45 + activity * .78) * pulse, 1);
        dummy.updateMatrix();
        flameParticles.mesh.setMatrixAt(i, dummy.matrix);
        flameParticles.opacity.setX(i, activity * .9);
      }
      flameParticles.mesh.instanceMatrix.needsUpdate = true;
      flameParticles.opacity.needsUpdate = true;

      for (let i = 0; i < smoke.length; i++) {
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
        smokeParticles.opacity.setX(i, residual * (puff.low ? .3 : .84) * Math.pow(Math.sin(Math.PI * life), .72));
      }
      smokeParticles.mesh.instanceMatrix.needsUpdate = true;
      smokeParticles.opacity.needsUpdate = true;

      for (let i = 0; i < embers.length; i++) {
        const ember = embers[i];
        const life = (timeSec * .24 + ember.phase) % 1;
        const flicker = .55 + .45 * Math.sin(timeSec * 15 + ember.phase * TAU) ** 2;
        dummy.position.set(ember.x + wind.x * life * 5, ember.y + life * (9 + ember.size * 2), ember.z + wind.z * life * 5);
        dummy.quaternion.copy(facing);
        dummy.scale.setScalar(ember.size * (.7 + life * .4));
        dummy.updateMatrix();
        emberParticles.mesh.setMatrixAt(i, dummy.matrix);
        emberParticles.opacity.setX(i, activity * .66 * (1 - life * .58) * flicker);
      }
      emberParticles.mesh.instanceMatrix.needsUpdate = true;
      emberParticles.opacity.needsUpdate = true;

      for (let i = 0; i < steam.length; i++) {
        const puff = steam[i];
        const life = (timeSec * .18 + puff.phase) % 1;
        const width = puff.size * (.7 + life * 1.6);
        dummy.position.set(puff.x + wind.x * life * 7, puff.y + 4 + life * 27, puff.z + wind.z * life * 7);
        dummy.quaternion.copy(facing);
        dummy.scale.set(width, width * (1 + life * .18), 1);
        dummy.updateMatrix();
        steamParticles.mesh.setMatrixAt(i, dummy.matrix);
        steamParticles.opacity.setX(i, steamStrength * .52 * Math.sin(Math.PI * life));
      }
      steamParticles.mesh.instanceMatrix.needsUpdate = true;
      steamParticles.opacity.needsUpdate = true;
    },
  };
}
