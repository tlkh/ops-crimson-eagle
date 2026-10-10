import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import type { ExtendedSimState } from '../sim/types';
import { bucketSurfaceHeight, LAKE_SURFACE_M } from '../sim/bucket';
import { createCoastalSampler } from './coastalSampling';
import { evaluateTimeOfDay } from './timeOfDay';

const PARTICLE_CAPACITY = 128;
const PHONE_PARTICLE_CAPACITY = 64;
const PHONE_ASPECT_LIMIT = .82;
const MAX_SIMULATION_DELTA = .05;
const SURFACE_SAMPLE_PERIOD = .12;
const NIGHT_SAMPLE_PERIOD = .25;
const ROTOR_RADIUS_M = 9.145;
const ROTOR_Z = [-5.7, 6.15] as const;
const ROTOR_Y = [2.73, 3.18] as const;
const DECK_SURFACE_Y = -2.525;
const TAU = Math.PI * 2;

const KIND_DUST = 0;
const KIND_DECK_DUST = 1;
const KIND_SPRAY = 2;
const KIND_ASH = 3;
const KIND_EMBER = 4;

const SURFACE_SEA = 0;
const SURFACE_LAND = 1;
const SURFACE_DECK = 2;
const SURFACE_LAKE = 3;
const SURFACE_SHALLOW = 4;

type SampleScratch = {
  t: number;
  s: number;
  shoreDistance: number;
  terrainHeight: number | null;
  surfaceHeight: number;
  isLand: boolean;
  isShallow: boolean;
};

/** Simulation-time delta for visual effects. Suspended frames advance by at most 50 ms. */
export function proximitySimulationDelta(previous: number | undefined, current: number): number {
  if (!Number.isFinite(current) || previous === undefined || !Number.isFinite(previous) || current < previous) return 0;
  return Math.min(MAX_SIMULATION_DELTA, Math.max(0, current - previous));
}

/** The point pool is capped at 64 sprites in narrow, phone-shaped views. */
export function proximityParticleBudget(aspect: number, narrowOrCoarse = false): number {
  return narrowOrCoarse || (Number.isFinite(aspect) && aspect < PHONE_ASPECT_LIMIT)
    ? PHONE_PARTICLE_CAPACITY
    : PARTICLE_CAPACITY;
}

function seeded(seed: number) {
  let value = seed >>> 0 || 1;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aOpacity;
      attribute float aNightTint;
      varying vec3 vColor;
      varying float vOpacity;
      varying float vNightTint;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(aSize * (220.0 / max(1.0, -viewPosition.z)), 1.0, 22.0);
        vColor = aColor;
        vOpacity = aOpacity;
        vNightTint = aNightTint;
      }
    `,
    fragmentShader: `
      uniform float uNightStrength;
      varying vec3 vColor;
      varying float vOpacity;
      varying float vNightTint;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        float alpha = vOpacity * (1.0 - smoothstep(0.06, 0.5, radius));
        if (alpha < 0.004) discard;
        vec3 nightColor = vColor * vec3(0.48, 0.62, 0.92);
        vec3 color = mix(vColor, nightColor, uNightStrength * vNightTint);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    uniforms: { uNightStrength: { value: 0 } },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: true,
  });
}

function inDeckBounds(campaign: Campaign, mission: Mission, x: number, z: number): boolean {
  const localX = x - mission.ship.x;
  const localZ = z - mission.ship.z;
  const stern = campaign.id === 'jp_ketapang_2026_09' ? 40 : 35;
  return Math.abs(localX) <= campaign.shipWidth / 2 &&
    localZ >= stern - campaign.shipLength && localZ <= stern;
}

function isInsideLake(mission: Mission, x: number, z: number): boolean {
  const dx = x - mission.lake.x;
  const dz = z - mission.lake.z;
  return dx * dx + dz * dz <= mission.lake.radius * mission.lake.radius;
}

function pulse(time: number, phase: number, period: number, burst: number): number {
  const cycle = (time + phase) % period;
  if (cycle >= burst) return 0;
  const fadeIn = clamp(cycle / .24, 0, 1);
  const fadeOut = clamp((burst - cycle) / .48, 0, 1);
  return fadeIn * fadeOut;
}

function burningFire(state: SimState): boolean {
  return state.fireState === 'burning' || state.fireState === 'surface_suppressed' || state.fireState === 'being_secured';
}

/** Sparse rotor wash, lake spray, and fire particles. All gameplay remains in SimState. */
export function createProximityParticles(scene: THREE.Scene, campaign: Campaign, mission: Mission): {
  update(state: SimState, camera: THREE.Camera): void;
  dispose(): void;
} {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_CAPACITY * 3);
  const colors = new Float32Array(PARTICLE_CAPACITY * 3);
  const sizes = new Float32Array(PARTICLE_CAPACITY);
  const opacities = new Float32Array(PARTICLE_CAPACITY);
  const nightTints = new Float32Array(PARTICLE_CAPACITY);
  const kinds = new Uint8Array(PARTICLE_CAPACITY);
  const rotorIndices = new Uint8Array(PARTICLE_CAPACITY);
  const phases = new Float32Array(PARTICLE_CAPACITY);
  const periods = new Float32Array(PARTICLE_CAPACITY);
  const bursts = new Float32Array(PARTICLE_CAPACITY);
  const localX = new Float32Array(PARTICLE_CAPACITY);
  const localZ = new Float32Array(PARTICLE_CAPACITY);
  const riseRates = new Float32Array(PARTICLE_CAPACITY);
  const opacityScale = new Float32Array(PARTICLE_CAPACITY);
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const opacityAttribute = new THREE.BufferAttribute(opacities, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aOpacity', opacityAttribute);
  geometry.setAttribute('aNightTint', new THREE.BufferAttribute(nightTints, 1));
  const material = createParticleMaterial();
  const points = new THREE.Points(geometry, material);
  points.name = 'Proximity particles';
  points.frustumCulled = false;
  points.renderOrder = 2;
  scene.add(points);

  const colorDust = [new THREE.Color('#a89b78'), new THREE.Color('#817d69'), new THREE.Color('#c4b48a')];
  const colorDeck = [new THREE.Color('#aab0a8'), new THREE.Color('#c2b99c')];
  const colorSpray = [new THREE.Color('#b5d4d4'), new THREE.Color('#d2ded3'), new THREE.Color('#92b9ba')];
  const colorAsh = [new THREE.Color('#4d4b43'), new THREE.Color('#69645a'), new THREE.Color('#777263')];
  const colorEmber = new THREE.Color('#ff9a4c');
  const random = seeded(mission.seed ^ (campaign.id === 'jp_ketapang_2026_09' ? 0x4a50414e : 0x52534146));

  for (let i = 0; i < PARTICLE_CAPACITY; i++) {
    // Keep every effect represented in the first 64 entries so portrait views
    // can reduce the draw range without changing the particle material or pool.
    let kind: number;
    if (i < 32 || (i >= 64 && i < 96)) kind = KIND_DUST;
    else if ((i >= 32 && i < 40) || (i >= 96 && i < 104)) kind = KIND_DECK_DUST;
    else if ((i >= 40 && i < 52) || (i >= 104 && i < 116)) kind = KIND_SPRAY;
    else kind = KIND_ASH;
    const ember = i === 62 || i === 126;
    if (ember) kind = KIND_EMBER;
    kinds[i] = kind;
    nightTints[i] = kind === KIND_EMBER ? 0 : 1;
    rotorIndices[i] = i % 2;
    phases[i] = random() * 12;
    periods[i] = kind === KIND_SPRAY ? 2.2 + random() * 2.5 : kind === KIND_EMBER ? 8 + random() * 7 : 4.5 + random() * 7.5;
    bursts[i] = kind === KIND_SPRAY ? .65 + random() * .9 : kind === KIND_EMBER ? .9 + random() * .9 : 1.5 + random() * 2.2;
    const angle = random() * TAU;
    const radial = Math.sqrt(random()) * (kind === KIND_DUST || kind === KIND_DECK_DUST ? ROTOR_RADIUS_M : kind === KIND_SPRAY ? 6.5 : 10);
    localX[i] = Math.cos(angle) * radial;
    localZ[i] = Math.sin(angle) * radial;
    riseRates[i] = kind === KIND_ASH ? .32 + random() * .42 : kind === KIND_EMBER ? 1.05 + random() * .65 : kind === KIND_SPRAY ? .18 + random() * .28 : .12 + random() * .5;
    opacityScale[i] = kind === KIND_DECK_DUST ? .58 + random() * .4 : kind === KIND_EMBER ? .48 + random() * .28 : .72 + random() * .28;
    sizes[i] = kind === KIND_DUST ? .34 + random() * .42 :
      kind === KIND_DECK_DUST ? .24 + random() * .28 :
        kind === KIND_SPRAY ? .24 + random() * .3 :
          kind === KIND_EMBER ? .15 + random() * .12 : .25 + random() * .26;
    const palette = kind === KIND_DUST ? colorDust : kind === KIND_DECK_DUST ? colorDeck : kind === KIND_SPRAY ? colorSpray : kind === KIND_EMBER ? [colorEmber] : colorAsh;
    const color = palette[Math.floor(random() * palette.length)];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const sampler = createCoastalSampler(campaign, mission);
  const surfaceScratch: SampleScratch[] = [
    { t: 0, s: 0, shoreDistance: 0, terrainHeight: null, surfaceHeight: -9, isLand: false, isShallow: false },
    { t: 0, s: 0, shoreDistance: 0, terrainHeight: null, surfaceHeight: -9, isLand: false, isShallow: false },
  ];
  const coastalScratch = { x: 0, z: 0 };
  const rotorSurface = new Float32Array(2);
  const rotorSurfaceKind = new Uint8Array(2);
  const lastSampleX = new Float32Array([Number.NaN, Number.NaN]);
  const lastSampleZ = new Float32Array([Number.NaN, Number.NaN]);
  let fireSurface = bucketSurfaceHeight(campaign, mission, mission.fire.x, mission.fire.z);
  let previousSimulationTime: number | undefined;
  let particleTime = 0;
  let sampleTimer = SURFACE_SAMPLE_PERIOD;
  let nightSampleTimer = NIGHT_SAMPLE_PERIOD;
  let nightStrength = 0;
  let budget = 0;
  let initialized = false;
  let disposed = false;
  const coarsePointer = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  const sampleRotorSurface = (rotor: number, x: number, z: number) => {
    const dx = x - lastSampleX[rotor];
    const dz = z - lastSampleZ[rotor];
    if (sampleTimer < SURFACE_SAMPLE_PERIOD && dx * dx + dz * dz < 16 && Number.isFinite(lastSampleX[rotor])) return;
    const sample = surfaceScratch[rotor];
    sampler.sampleInto(x, z, sample);
    const deck = inDeckBounds(campaign, mission, x, z);
    const lake = isInsideLake(mission, x, z);
    const surfaceY = deck ? DECK_SURFACE_Y : lake ? LAKE_SURFACE_M : bucketSurfaceHeight(campaign, mission, x, z);
    rotorSurface[rotor] = surfaceY;
    if (deck) rotorSurfaceKind[rotor] = SURFACE_DECK;
    else if (lake) rotorSurfaceKind[rotor] = SURFACE_LAKE;
    else if (sample.isLand || surfaceY > -9) rotorSurfaceKind[rotor] = SURFACE_LAND;
    else if (sample.isShallow) rotorSurfaceKind[rotor] = SURFACE_SHALLOW;
    else rotorSurfaceKind[rotor] = SURFACE_SEA;
    lastSampleX[rotor] = x;
    lastSampleZ[rotor] = z;
  };

  return {
    update(state, camera) {
      if (disposed) return;
      const time = state.timeSec;
      const backwards = previousSimulationTime !== undefined && time < previousSimulationTime;
      const delta = proximitySimulationDelta(previousSimulationTime, time);
      previousSimulationTime = time;
      if (backwards) {
        particleTime = 0;
        sampleTimer = SURFACE_SAMPLE_PERIOD;
        nightSampleTimer = NIGHT_SAMPLE_PERIOD;
        lastSampleX.fill(Number.NaN);
        lastSampleZ.fill(Number.NaN);
        opacities.fill(0);
      } else particleTime += delta;

      const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
      nightSampleTimer += delta;
      if (nightSampleTimer >= NIGHT_SAMPLE_PERIOD) {
        nightStrength = evaluateTimeOfDay(mission, time).nightStrength;
        nightSampleTimer = 0;
        material.uniforms.uNightStrength.value = nightStrength;
      }
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth < 768;
      const nextBudget = proximityParticleBudget(aspect, narrowViewport || coarsePointer);
      const budgetChanged = nextBudget !== budget;
      if (budgetChanged) {
        budget = nextBudget;
        geometry.setDrawRange(0, budget);
      }
      if (!initialized || delta > 0 || budgetChanged || backwards) {
        sampleTimer += delta;
        const heading = state.heading;
        const sinHeading = Math.sin(heading);
        const cosHeading = Math.cos(heading);
        for (let rotor = 0; rotor < 2; rotor++) {
          const zOffset = ROTOR_Z[rotor];
          const rotorX = state.position.x + sinHeading * zOffset;
          const rotorZ = state.position.z + cosHeading * zOffset;
          sampleRotorSurface(rotor, rotorX, rotorZ);
        }
        if (sampleTimer >= SURFACE_SAMPLE_PERIOD) {
          fireSurface = bucketSurfaceHeight(campaign, mission, mission.fire.x, mission.fire.z);
          sampleTimer = 0;
        }

        const extended = state as ExtendedSimState;
        const rotorSpeed = state.phase === 'prepare' || state.phase === 'deck_rig' || state.phase === 'land' ? .24 : 1;
        const aircraftSpeed = Math.hypot(state.velocity.x, state.velocity.z);
        const fireActive = burningFire(state) && state.fireHeat + state.peatHeat * .35 > 3;
        const fireHeat = clamp((state.fireHeat + state.peatHeat * .35) / 100, 0, 1);
        const nearFireX = state.position.x - mission.fire.x;
        const nearFireZ = state.position.z - mission.fire.z;
        const fireInRange = nearFireX * nearFireX + nearFireZ * nearFireZ <= 190 * 190;
        const waterFetch = extended.fetching === true && extended.bucketAttached === true && isInsideLake(mission, state.bucket.x, state.bucket.z);
        const lakeWaterY = LAKE_SURFACE_M;

        for (let i = 0; i < budget; i++) {
          const kind = kinds[i];
          const rotor = rotorIndices[i];
          const ageFade = pulse(particleTime, phases[i], periods[i], bursts[i]);
          const particleAge = (particleTime + phases[i]) % periods[i];
          let alpha = 0;
          let x = 0, y = 0, z = 0;
          if (kind === KIND_DUST || kind === KIND_DECK_DUST) {
            const surfaceKind = rotorSurfaceKind[rotor];
            const hubY = state.position.y + ROTOR_Y[rotor];
            const height = hubY - rotorSurface[rotor];
            const withinGroundEffect = height > 0 && height <= 25;
            const wash = clamp((25 - height) / 25, 0, 1) * (.18 + rotorSpeed * .82) * clamp(.55 + aircraftSpeed * .025, .55, 1.3);
            const isDeck = surfaceKind === SURFACE_DECK;
            if (ageFade > 0 && withinGroundEffect && (surfaceKind === SURFACE_LAND || isDeck)) {
              const headingX = localX[i] * cosHeading + localZ[i] * sinHeading;
              const headingZ = -localX[i] * sinHeading + localZ[i] * cosHeading;
              const drift = particleAge * .09;
              x = state.position.x + sinHeading * ROTOR_Z[rotor] + headingX + state.velocity.x * drift;
              z = state.position.z + cosHeading * ROTOR_Z[rotor] + headingZ + state.velocity.z * drift;
              const pulseY = .08 + ageFade * riseRates[i] * 1.4 + Math.sin(particleTime * 2 + phases[i]) * .12;
              y = rotorSurface[rotor] + pulseY;
              const inActualDeck = !isDeck || inDeckBounds(campaign, mission, x, z);
              if (inActualDeck) {
                const groundGain = isDeck ? .035 : .17;
                alpha = ageFade * opacityScale[i] * wash * groundGain;
              }
            }
          } else if (kind === KIND_SPRAY) {
            const surfaceKind = rotorSurfaceKind[rotor];
            const sprayY = surfaceKind === SURFACE_LAKE ? lakeWaterY : -9;
            const lakeSpray = surfaceKind === SURFACE_LAKE && state.position.y + ROTOR_Y[rotor] - sprayY <= 25;
            const coastSpray = surfaceKind === SURFACE_SHALLOW && state.position.y + ROTOR_Y[rotor] - sprayY <= 25;
            if (ageFade > 0 && (lakeSpray || coastSpray || waterFetch)) {
              const anchorX = waterFetch ? state.bucket.x : state.position.x + sinHeading * ROTOR_Z[rotor];
              const anchorZ = waterFetch ? state.bucket.z : state.position.z + cosHeading * ROTOR_Z[rotor];
              const headingX = localX[i] * cosHeading + localZ[i] * sinHeading;
              const headingZ = -localX[i] * sinHeading + localZ[i] * cosHeading;
              x = anchorX + headingX * (waterFetch ? .24 : 1) + state.velocity.x * particleAge * .015;
              z = anchorZ + headingZ * (waterFetch ? .24 : 1) + state.velocity.z * particleAge * .015;
              const inLake = isInsideLake(mission, x, z);
              let overShallowWater = false;
              if (!inLake && coastSpray && !waterFetch) {
                sampler.toLocalInto(x, z, coastalScratch);
                overShallowWater = coastalScratch.x - sampler.coastAt(coastalScratch.z) < 0;
              }
              if ((inLake && (lakeSpray || waterFetch)) || overShallowWater) {
                const waterHeight = inLake ? lakeWaterY : -9;
                const heightGain = waterFetch ? 1 : clamp((25 - (state.position.y + ROTOR_Y[rotor] - sprayY)) / 25, 0, 1);
                y = waterHeight + .07 + ageFade * riseRates[i] * .35;
                alpha = ageFade * opacityScale[i] * heightGain * (waterFetch ? .09 : .13);
              }
            }
          } else if (ageFade > 0 && fireActive && fireInRange) {
            const ember = kind === KIND_EMBER;
            const spread = ember ? 13 : Math.min(10, mission.fire.radius * .12);
            x = mission.fire.x + localX[i] * spread / ROTOR_RADIUS_M + mission.wind.x * particleAge * (ember ? .045 : .025);
            z = mission.fire.z + localZ[i] * spread / ROTOR_RADIUS_M + mission.wind.z * particleAge * (ember ? .045 : .025);
            const rise = ageFade * riseRates[i] * (ember ? 2.3 : .9);
            y = fireSurface + (ember ? .55 : .28) + rise + Math.sin(particleTime * 1.6 + phases[i]) * .09;
            alpha = ageFade * opacityScale[i] * fireHeat * (ember ? .17 : .11);
          }
          const offset = i * 3;
          positions[offset] = x;
          positions[offset + 1] = y;
          positions[offset + 2] = z;
          opacities[i] = backwards ? 0 : alpha;
        }
        positionAttribute.needsUpdate = true;
        opacityAttribute.needsUpdate = true;
        initialized = true;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(points);
      geometry.dispose();
      material.dispose();
    },
  };
}
