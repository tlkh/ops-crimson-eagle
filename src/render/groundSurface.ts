import * as THREE from 'three';
import type { SimState } from '../types';
import type { BurnField } from './burnField';

const ATLAS_PATH = 'graphics/terrain-atlas.ktx2';
const TILE_SIZE = 256;
const TILE_GUTTER = 16;
const TILE_CELL = TILE_SIZE + TILE_GUTTER * 2;
const ATLAS_WIDTH = TILE_CELL * 3;

type TextureLease = {
  placeholder: THREE.Texture;
  ready: Promise<THREE.Texture>;
  release(): void;
};

export type GroundTextureAssets = {
  acquire(path: string, options: { colorSpace: THREE.ColorSpace; fallback: THREE.Texture }): TextureLease;
};

function makeBurnTexture(field?: BurnField): THREE.DataTexture {
  const size = field?.size ?? 1;
  if (field && (!Number.isInteger(size) || size < 2 || field.data.length !== size * size * 4 ||
      !Number.isFinite(field.bounds.minX) || !Number.isFinite(field.bounds.maxX) ||
      !Number.isFinite(field.bounds.minZ) || !Number.isFinite(field.bounds.maxZ) ||
      field.bounds.maxX <= field.bounds.minX || field.bounds.maxZ <= field.bounds.minZ)) {
    throw new RangeError('Burn field must have a square RGBA grid and non-empty finite bounds');
  }
  const texture = new THREE.DataTexture(field?.data ?? new Uint8Array(4), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

type GroundSurface = {
  material: THREE.MeshStandardMaterial;
  update(state?: Pick<SimState, 'timeSec' | 'fireHeat'>): void;
  dispose(): void;
};

// A modest fallback keeps preview rendering immediate when no renderer-backed
// texture cache is available. The production atlas is acquired below.
function makeFallbackAtlas(): THREE.DataTexture {
  const pixels = new Uint8Array(ATLAS_WIDTH * TILE_CELL * 4);
  const seeds = [0x51731a, 0x6e1f09, 0x9ad318];
  for (let y = 0; y < TILE_CELL; y++) {
    for (let x = 0; x < ATLAS_WIDTH; x++) {
      const tile = Math.min(2, Math.floor(x / TILE_CELL));
      const localX = x - tile * TILE_CELL - TILE_GUTTER;
      const localY = y - TILE_GUTTER;
      const u = (localX + .5) / TILE_SIZE;
      const v = (localY + .5) / TILE_SIZE;
      const phase = seeds[tile] * 1e-6;
      const macro = .5 + .5 * Math.sin(u * Math.PI * 10 + Math.cos(v * Math.PI * 8 + phase));
      const fibers = .5 + .5 * Math.sin((v * 27 + Math.sin(u * Math.PI * 6 + phase) * .08) * Math.PI * 2);
      const grain = .5 + .5 * Math.sin(u * 271 + v * 197 + phase * 2);
      const brightness = .65 + macro * .14 + fibers * (tile === 2 ? .035 : .09) + (grain - .5) * .1;
      const relief = .34 + macro * .28 + fibers * .14 + (grain - .5) * .12;
      const roughness = .70 + macro * .13 + (grain - .5) * .1;
      const index = (y * ATLAS_WIDTH + x) * 4;
      pixels[index] = Math.round(THREE.MathUtils.clamp(brightness, 0, 1) * 255);
      pixels[index + 1] = Math.round(THREE.MathUtils.clamp(relief, 0, 1) * 255);
      pixels[index + 2] = Math.round(THREE.MathUtils.clamp(roughness, 0, 1) * 255);
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, ATLAS_WIDTH, TILE_CELL, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createGroundSurface(textureAssets?: GroundTextureAssets, burnField?: BurnField): GroundSurface {
  const burnTexture = makeBurnTexture(burnField);
  const fallbackAtlas = makeFallbackAtlas();
  let disposed = false;
  const lease = textureAssets?.acquire(ATLAS_PATH, { colorSpace: THREE.NoColorSpace, fallback: fallbackAtlas });
  let atlas = lease?.placeholder ?? fallbackAtlas;
  const compiledShaders: Array<{ uniforms: Record<string, { value: unknown }> }> = [];
  // The PNG source serves previews without a renderer-backed KTX cache and
  // also covers a missing/unreadable compressed asset. Copying it into the
  // immediate fallback keeps all already-compiled uniforms valid.
  const loadPngFallback = () => {
    if (disposed || typeof document === 'undefined') return;
    const loader = new THREE.TextureLoader();
    const png = loader.load(`${import.meta.env.BASE_URL}graphics/terrain-atlas.png`, loaded => {
      if (!disposed) {
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_WIDTH;
        canvas.height = TILE_CELL;
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(loaded.image, 0, 0, ATLAS_WIDTH, TILE_CELL);
          fallbackAtlas.image.data.set(context.getImageData(0, 0, ATLAS_WIDTH, TILE_CELL).data);
          fallbackAtlas.needsUpdate = true;
        }
      }
      loaded.dispose();
    }, undefined, () => undefined);
    png.colorSpace = THREE.NoColorSpace;
  };
  if (!lease) loadPngFallback();
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1 });
  const wetStrengthUniform = { value: 0 };
  let lastHeat: number | undefined;
  let lastTime: number | undefined;
  material.onBeforeCompile = shader => {
    shader.uniforms.groundAtlas = { value: atlas };
    shader.uniforms.groundBurnField = { value: burnTexture };
    shader.uniforms.groundBurnBounds = { value: burnField
      ? new THREE.Vector4(burnField.bounds.minX, burnField.bounds.maxX, burnField.bounds.minZ, burnField.bounds.maxZ)
      : new THREE.Vector4(0, 1, 0, 1) };
    shader.uniforms.groundBurnSize = { value: burnField?.size ?? 1 };
    shader.uniforms.groundBurnEnabled = { value: burnField ? 1 : 0 };
    shader.uniforms.groundWetStrength = wetStrengthUniform;
    compiledShaders.push(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 groundBiome;
        varying vec3 vGroundBiome;
        varying vec3 vGroundWorldPosition;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGroundBiome = groundBiome;
        vGroundWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D groundAtlas;
        uniform sampler2D groundBurnField;
        uniform vec4 groundBurnBounds;
        uniform float groundBurnSize;
        uniform float groundBurnEnabled;
        uniform float groundWetStrength;
        varying vec3 vGroundBiome;
        varying vec3 vGroundWorldPosition;
        vec2 groundAtlasUv(vec2 p, float tile) {
          vec2 wrapped = fract(p);
          return vec2((tile * ${TILE_CELL.toFixed(1)} + ${TILE_GUTTER.toFixed(1)} + wrapped.x * ${TILE_SIZE.toFixed(1)}) / ${ATLAS_WIDTH.toFixed(1)},
            (${TILE_GUTTER.toFixed(1)} + wrapped.y * ${TILE_SIZE.toFixed(1)}) / ${TILE_CELL.toFixed(1)});
        }
        float groundHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float groundNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(groundHash(i), groundHash(i + vec2(1.0,0.0)), f.x),
            mix(groundHash(i + vec2(0.0,1.0)), groundHash(i + vec2(1.0,1.0)), f.x), f.y);
        }
        vec4 sampleGroundBurnField(vec2 p) {
          if (groundBurnEnabled < .5 || p.x < groundBurnBounds.x || p.x > groundBurnBounds.y ||
              p.y < groundBurnBounds.z || p.y > groundBurnBounds.w) return vec4(0.0);
          vec2 grid = (p - groundBurnBounds.xz) / (groundBurnBounds.yw - groundBurnBounds.xz);
          // The authored grid stores pixel i at min + range*i/(size-1). Map
          // those samples to texel centers so the GPU agrees with sample().
          vec2 uv = (grid * (groundBurnSize - 1.0) + .5) / groundBurnSize;
          return texture2D(groundBurnField, uv);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 groundWeights = max(vGroundBiome, vec3(0.0));
        groundWeights /= max(dot(groundWeights, vec3(1.0)), .001);
        vec2 worldXZ = vGroundWorldPosition.xz;
        vec4 grassSample = texture2D(groundAtlas, groundAtlasUv(worldXZ * .095, 0.0));
        vec4 peatSample = texture2D(groundAtlas, groundAtlasUv(worldXZ * .073, 1.0));
        vec4 sandSample = texture2D(groundAtlas, groundAtlasUv(worldXZ * .13, 2.0));
        vec4 groundSample = grassSample * groundWeights.x + peatSample * groundWeights.y + sandSample * groundWeights.z;
        float groundDistance = length(cameraPosition - vGroundWorldPosition);
        float groundDetailFade = 1.0 - smoothstep(110.0, 720.0, groundDistance);
        vec2 macroDomain = worldXZ * .0028;
        macroDomain += (vec2(groundNoise(macroDomain + vec2(3.2, 8.1)), groundNoise(macroDomain + vec2(12.4, 2.7))) - .5) * .9;
        float broadPatch = groundNoise(macroDomain);
        float mediumPatch = groundNoise(worldXZ * .009 + vec2(4.7, 11.3));
        float grassTone = groundNoise(macroDomain + vec2(2.1, 5.8));
        float peatTone = groundNoise(macroDomain + vec2(8.7, 1.4));
        float sandTone = groundNoise(macroDomain + vec2(5.2, 13.1));
        vec4 burnFieldSample = sampleGroundBurnField(worldXZ);
        float burnSeverity = burnFieldSample.r;
        float burnAge = burnFieldSample.g;
        float burnActivity = burnFieldSample.b;
        float burnEligibility = burnFieldSample.a;
        float burnCoverage = clamp(burnSeverity * burnEligibility, 0.0, 1.0);
        float burnCharCore = smoothstep(.49, .77, burnSeverity) * (1.0 - .58 * smoothstep(.28, .94, burnAge));
        float burnAshLayer = smoothstep(.23, .56, burnSeverity) * smoothstep(.24, .79, burnAge);
        float burnSingedFringe = smoothstep(.012, .16, burnSeverity) * (1.0 - smoothstep(.36, .68, burnSeverity));
        burnCharCore *= burnCoverage;
        float burnDetailFade = 1.0 - smoothstep(28.0, 145.0, groundDistance);
        float burnMottle = .5;
        float burnAshMottle = .5;
        float burnFringeNoise = .5;
        float burnBranchTrace = 0.0;
        float burnCharImprint = 0.0;
        float groundWetMask = 0.0;
        if (burnCoverage > .001) {
          // Keep the scar broad and matte. These low-frequency variations
          // become quieter with distance; only sparse branch-like marks use
          // finer coordinates, and those fade first.
          burnMottle = mix(.5, groundNoise(worldXZ * .105 + vec2(17.1, 4.3)), burnDetailFade);
          burnAshMottle = mix(.5, groundNoise(worldXZ * vec2(.105, .16) + vec2(5.4, 14.8)), burnDetailFade);
          burnFringeNoise = mix(.5, groundNoise(worldXZ * .13 + vec2(9.8, 3.6)), burnDetailFade);
          float burnBranchWarp = groundNoise(worldXZ * .075 + vec2(21.2, 6.7));
          burnBranchTrace = smoothstep(.84, .96, groundNoise(vec2(worldXZ.x * .46 + burnBranchWarp * 1.3,
            worldXZ.y * .055 + burnBranchWarp * .18))) * burnDetailFade;
          burnCharImprint = burnCharCore * burnBranchTrace * .16;
          burnAshLayer *= .72 + .28 * burnAshMottle;
          burnSingedFringe *= (.77 + .23 * burnActivity) * (.85 + .15 * burnFringeNoise);
          float recentChar = (1.0 - smoothstep(.18, .74, burnAge)) * smoothstep(.48, .78, burnSeverity);
          groundWetMask = max(burnActivity * .9, recentChar * .24) * burnEligibility;
        }
        burnAshLayer *= burnCoverage * (1.0 - .28 * burnCharCore);
        burnSingedFringe *= burnCoverage;
        float groundWetness = clamp(groundWetStrength * groundWetMask, 0.0, 1.0);
        vec3 grassTint = mix(vec3(.87, .94, .77), vec3(1.08, 1.11, .94), grassTone);
        vec3 peatTint = mix(vec3(.77, .69, .54), vec3(1.06, .98, .79), peatTone);
        vec3 sandTint = mix(vec3(.92, .84, .66), vec3(1.12, 1.06, .88), sandTone);
        vec3 habitatTint = grassTint * groundWeights.x + peatTint * groundWeights.y + sandTint * groundWeights.z;
        vec3 singedTint = mix(vec3(.25, .16, .095), vec3(.39, .27, .15), burnFringeNoise);
        vec3 ashTint = mix(vec3(.30, .285, .255), vec3(.49, .445, .38), burnAshMottle);
        vec3 charcoalTint = mix(vec3(.018, .017, .015), vec3(.048, .043, .036), burnMottle);
        charcoalTint = mix(charcoalTint, vec3(.008, .008, .007), burnCharImprint);
        float macroBreakup = (broadPatch - .5) * .20 + (mediumPatch - .5) * .12;
        float albedoVariation = (groundSample.r - .5) * .34;
        diffuseColor.rgb *= mix(vec3(1.0), habitatTint, .72);
        diffuseColor.rgb *= 1.0 + macroBreakup;
        diffuseColor.rgb *= 1.0 + albedoVariation * groundDetailFade;
        diffuseColor.rgb = mix(diffuseColor.rgb, singedTint, burnSingedFringe * .74);
        diffuseColor.rgb = mix(diffuseColor.rgb, ashTint, burnAshLayer * (.65 + .2 * burnAshMottle));
        diffuseColor.rgb = mix(diffuseColor.rgb, charcoalTint, burnCharCore * (.88 + .08 * burnMottle));
        diffuseColor.rgb *= 1.0 - groundWetness * .24;
        float burnRelief = (burnAshLayer * (.004 + .003 * burnAshMottle)
          - burnCharCore * (.004 + .003 * burnMottle) + burnCharImprint * .001) * burnDetailFade;
        float groundBumpHeight = (groundSample.g - .5) * .22 * groundDetailFade + burnRelief;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float grassRoughness = .70 + grassSample.b * .28;
        float peatRoughness = .62 + peatSample.b * .32;
        float sandRoughness = .56 + sandSample.b * .34;
        float detailedRoughness = dot(groundWeights, vec3(grassRoughness, peatRoughness, sandRoughness));
        roughnessFactor = clamp(mix(.97, detailedRoughness, groundDetailFade) + burnCharCore * .07
          + burnAshLayer * .035 + burnSingedFringe * .012 - groundWetness * .34, .05, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 groundPosition = -vViewPosition;
        vec3 groundSigmaX = normalize(dFdx(groundPosition));
        vec3 groundSigmaY = normalize(dFdy(groundPosition));
        vec3 groundR1 = cross(groundSigmaY, normal);
        vec3 groundR2 = cross(normal, groundSigmaX);
        float groundDet = dot(groundSigmaX, groundR1);
        vec3 groundGradient = sign(groundDet) * (dFdx(groundBumpHeight) * groundR1 + dFdy(groundBumpHeight) * groundR2);
        normal = normalize(abs(groundDet) * normal - groundGradient);`);
  };
  material.customProgramCacheKey = () => 'ground-surface-atlas-burn-v3';
  if (lease) {
    void lease.ready.then(readyAtlas => {
      if (disposed) return;
      if (readyAtlas === fallbackAtlas) {
        loadPngFallback();
        return;
      }
      atlas = readyAtlas;
      for (const shader of compiledShaders) shader.uniforms.groundAtlas.value = readyAtlas;
    });
  }
  return {
    material,
    update(state) {
      if (!state) return;
      const time = Number.isFinite(state.timeSec) ? state.timeSec : (lastTime ?? 0);
      const heat = Number.isFinite(state.fireHeat) ? state.fireHeat : (lastHeat ?? 0);
      const delta = lastTime === undefined ? 0 : THREE.MathUtils.clamp(time - lastTime, 0, .5);
      const cooling = lastHeat === undefined ? 0 : Math.max(0, lastHeat - heat);
      wetStrengthUniform.value = Math.max(
        wetStrengthUniform.value * Math.exp(-delta * .085),
        cooling > .015 ? THREE.MathUtils.clamp(cooling / 22, .08, .82) : 0,
      );
      lastHeat = heat;
      lastTime = time;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lease?.release();
      fallbackAtlas.dispose();
      burnTexture.dispose();
      compiledShaders.length = 0;
      material.dispose();
    },
  };
}
