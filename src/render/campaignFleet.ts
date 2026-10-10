import * as THREE from 'three';
import type { Campaign } from '../types';
import { createAircraft } from './aircraft';
import { createShip } from './ships';
import { createWater } from './water';
import { createEnvironmentLighting } from './environmentLighting';
import { evaluateTimeOfDay } from './timeOfDay';

const WIDTH = 1200;
const HEIGHT = 420;
const fleetImages = new Map<Campaign['id'], Promise<string>>();

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
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function renderFleet(campaign: Campaign): string {
  const sourceMission = campaign.missions[0];
  if (!sourceMission) throw new Error(`Campaign ${campaign.id} has no mission to render its ship.`);

  const mission = {
    ...sourceMission,
    ship: { ...sourceMission.ship, x: 0, z: 0 },
  };
  const scene = new THREE.Scene();
  let renderer: THREE.WebGLRenderer | undefined;
  let water: ReturnType<typeof createWater> | undefined;
  let environment: ReturnType<typeof createEnvironmentLighting> | undefined;
  try {
    scene.background = new THREE.Color('#cad9df');
    scene.fog = new THREE.Fog('#cad9df', 360, 1500);

    scene.add(new THREE.HemisphereLight('#e7f1eb', '#5e6c70', 2.1));
    const sun = new THREE.DirectionalLight('#fff3df', 2.8);
    sun.position.set(120, 170, -90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -135;
    sun.shadow.camera.right = 135;
    sun.shadow.camera.top = 95;
    sun.shadow.camera.bottom = -95;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 480;
    sun.shadow.bias = -.00025;
    sun.shadow.normalBias = .12;
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);

    water = createWater(scene, campaign, mission);
    water.surface(new THREE.PlaneGeometry(2200, 2200), 0, new THREE.Vector3(0, -9, 0));
    water.update(14);

    createShip(scene, campaign, mission);
    const aircraft = createAircraft(campaign);
    // The campaign marker is the aft landing area. Keep the aircraft parallel to
    // the ship, just outside its starboard side and above the open aft deck.
    aircraft.root.position.set(campaign.shipWidth / 2 + 15, 25, 0);
    for (const rotor of aircraft.rotors) {
      const disc = rotor.userData.disc as THREE.Mesh;
      disc.visible = true;
      (disc.material as THREE.MeshBasicMaterial).opacity = .92;
      for (const blade of rotor.userData.blades as THREE.Mesh[]) {
        blade.visible = false;
        const material = blade.material as THREE.MeshStandardMaterial;
        material.opacity = 0;
        material.depthWrite = false;
      }
    }
    scene.add(aircraft.root);

    const viewWidth = campaign.shipLength * 1.27;
    // A long-lens, near-broadside view reveals the real sheer, bridge tiers and
    // freeboard. The former elevated orthographic view flattened the silhouette
    // against an all-water background and hid the bow's vertical rake.
    const camera = new THREE.PerspectiveCamera(18, WIDTH / HEIGHT, .1, 2200);
    const viewDistance = viewWidth / (2 * Math.tan(THREE.MathUtils.degToRad(9)) * camera.aspect);
    const centerZ = (campaign.id === 'jp_ketapang_2026_09' ? 40 : 35) - campaign.shipLength / 2;
    camera.position.set(viewDistance, 7 + viewDistance * .075, centerZ + 6);
    camera.lookAt(0, 7, centerZ);
    camera.updateProjectionMatrix();

    renderer = new THREE.WebGLRenderer({
      canvas: document.createElement('canvas'),
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    environment = createEnvironmentLighting(renderer, scene);
    environment.update(evaluateTimeOfDay(mission, mission.durationTargetSec * .5));
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    water?.dispose();
    environment?.dispose();
    disposeScene(scene);
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}

/** Render and cache a static, broadside thumbnail for each campaign. */
export async function renderCampaignFleet(campaign: Campaign): Promise<string> {
  const cached = fleetImages.get(campaign.id);
  if (cached) return cached;

  const pending = Promise.resolve().then(() => renderFleet(campaign));
  fleetImages.set(campaign.id, pending);
  try {
    return await pending;
  } catch (error) {
    if (fleetImages.get(campaign.id) === pending) fleetImages.delete(campaign.id);
    throw error;
  }
}
