import * as THREE from 'three';
import type { Campaign, Mission } from '../types';
import { createFire } from './fire';
import { createShip } from './ships';
import { createWorld } from './world';
import { CAMPAIGN_TERRAIN_ORIGIN } from '../content/terrainFrame';

export type BriefingTerrainFrame = {
  width: number;
  height: number;
  scale: number;
  origin: { x: number; y: number };
  basis: { inlandX: number; inlandZ: number; lateralX: number; lateralZ: number };
};

const MAX_CACHE_ENTRIES = 12;
const CAPTURE_PIXEL_RATIO = 2;
const terrainImages = new Map<string, Promise<string>>();
let renderQueue: Promise<void> = Promise.resolve();

function cacheKey(campaign: Campaign, mission: Mission, frame: BriefingTerrainFrame): string {
  const { width, height, scale, origin, basis } = frame;
  return `${campaign.id}:${JSON.stringify(mission)}:${[
    width, height, scale, origin.x, origin.y,
    basis.inlandX, basis.inlandZ, basis.lateralX, basis.lateralZ,
  ].join(',')}`;
}

export type BriefingTerrainCameraProjection = {
  width: number;
  height: number;
  scale: number;
  centerX: number;
  centerZ: number;
  rightX: number;
  rightZ: number;
};

/** Camera transform shared with projection checks; raster pixels are 2× the map model. */
export function briefingTerrainCameraProjection(
  _mission: Mission,
  frame: BriefingTerrainFrame,
): BriefingTerrainCameraProjection {
  const width = Math.max(1, Math.round(frame.width * CAPTURE_PIXEL_RATIO));
  const height = Math.max(1, Math.round(frame.height * CAPTURE_PIXEL_RATIO));
  const scale = frame.scale * CAPTURE_PIXEL_RATIO;
  if (![width, height, scale, frame.origin.x, frame.origin.y,
    frame.basis.inlandX, frame.basis.inlandZ, frame.basis.lateralX, frame.basis.lateralZ].every(Number.isFinite) || scale <= 0) {
    throw new Error('Briefing terrain frame must have finite coordinates and a positive scale.');
  }

  const originX = frame.origin.x * CAPTURE_PIXEL_RATIO;
  const originY = frame.origin.y * CAPTURE_PIXEL_RATIO;
  const lateralOffset = (width / 2 - originX) / scale;
  const inlandOffset = (originY - height / 2) / scale;
  return {
    width,
    height,
    scale,
    centerX: CAMPAIGN_TERRAIN_ORIGIN.x + frame.basis.lateralX * lateralOffset + frame.basis.inlandX * inlandOffset,
    centerZ: CAMPAIGN_TERRAIN_ORIGIN.z + frame.basis.lateralZ * lateralOffset + frame.basis.inlandZ * inlandOffset,
    rightX: -frame.basis.inlandZ,
    rightZ: frame.basis.inlandX,
  };
}

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      if (material instanceof THREE.ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
        }
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function renderTerrain(campaign: Campaign, sourceMission: Mission, frame: BriefingTerrainFrame): string {
  const projection = briefingTerrainCameraProjection(sourceMission, frame);
  const { width, height, scale } = projection;

  // createWorld registers terrain and obstacle data by Mission identity. A
  // shallow copy keeps those preview-only entries out of the live simulation.
  const mission: Mission = {
    ...sourceMission,
    timeOfDay: { startMinutes: 720, endMinutes: 720 },
  };
  const scene = new THREE.Scene();
  let renderer: THREE.WebGLRenderer | undefined;
  let world: ReturnType<typeof createWorld> | undefined;

  try {
    scene.background = new THREE.Color('#cbd8ce');
    scene.add(new THREE.HemisphereLight('#f0f4ed', '#69745f', 2.15));
    const sun = new THREE.DirectionalLight('#fff4df', 2.5);
    sun.position.set(sourceMission.ship.x + 5200, 9000, sourceMission.ship.z - 4100);
    scene.add(sun);

    world = createWorld(scene, campaign, mission, { preview: true });
    createShip(scene, campaign, mission);

    const viewWidth = width / scale;
    const viewHeight = height / scale;
    const { centerX, centerZ } = projection;
    const camera = new THREE.OrthographicCamera(
      -viewWidth / 2, viewWidth / 2, viewHeight / 2, -viewHeight / 2, .1, 30000,
    );
    camera.up.set(frame.basis.inlandX, 0, frame.basis.inlandZ);
    camera.position.set(centerX, 20000, centerZ);
    camera.lookAt(centerX, 0, centerZ);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    // The preview mission has a fixed midday arc, keeping authored geometry
    // readable even for sorties that begin or end at night.
    world.update(0, camera.position);
    const fire = createFire(scene, mission, world.terrainHeight, world.burnField);
    fire.update(0, 100, true, mission.wind, camera);

    renderer = new THREE.WebGLRenderer({
      canvas: document.createElement('canvas'),
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // A large overhead shadow pass is costly over the full authored forest;
    // geometry, vertex colours and direct daylight keep the terrain legible.
    renderer.shadowMap.enabled = false;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    world?.dispose();
    disposeScene(scene);
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}

/** Capture the actual authored terrain, lake, ship, settlement and fire from above. */
export async function renderBriefingTerrain(
  campaign: Campaign,
  mission: Mission,
  frame: BriefingTerrainFrame,
): Promise<string> {
  const key = cacheKey(campaign, mission, frame);
  const cached = terrainImages.get(key);
  if (cached) {
    terrainImages.delete(key);
    terrainImages.set(key, cached);
    return cached;
  }

  const pending = new Promise<string>((resolve, reject) => {
    const task = renderQueue.then(() => renderTerrain(campaign, mission, frame));
    renderQueue = task.then(() => undefined, () => undefined);
    task.then(resolve, reject);
  });
  terrainImages.set(key, pending);
  while (terrainImages.size > MAX_CACHE_ENTRIES) {
    const oldest = terrainImages.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    terrainImages.delete(oldest);
  }

  try {
    return await pending;
  } catch (error) {
    if (terrainImages.get(key) === pending) terrainImages.delete(key);
    throw error;
  }
}
