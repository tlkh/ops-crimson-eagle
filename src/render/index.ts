import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import type { ExtendedSimState } from '../sim/types';
import { createAircraft } from './aircraft';
import { createFire } from './fire';
import { createWorld } from './world';
import { createShip } from './ships';
import { createBucketRig } from './bucket';
import { createGroundCrew } from './groundCrew';
import { createHeightFog } from './heightFog';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function radialTexture(stops: Array<[number, string]>) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 63);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCrashEffect(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.visible = false;
  const flashTexture = radialTexture([
    [0, 'rgba(255,255,228,1)'], [.14, 'rgba(255,220,119,.96)'],
    [.42, 'rgba(255,103,28,.7)'], [1, 'rgba(255,62,12,0)'],
  ]);
  const smokeTexture = radialTexture([
    [0, 'rgba(37,39,36,.76)'], [.42, 'rgba(55,57,51,.55)'], [.78, 'rgba(73,73,65,.2)'], [1, 'rgba(73,73,65,0)'],
  ]);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTexture, color: '#fff1c0', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  root.add(flash);
  const smoke = Array.from({ length: 4 }, (_, i) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    sprite.position.set((i - 1.5) * 2.4, i * 1.1, ((i % 2) ? 1 : -1) * 1.7);
    root.add(sprite);
    return { sprite, phase: i * .19, size: 7 + (i % 3) * 2 };
  });
  const sparks = Array.from({ length: 12 }, (_, i) => {
    const angle = i / 12 * Math.PI * 2 + .17;
    const elevation = .25 + (i % 4) * .18;
    const velocity = new THREE.Vector3(Math.cos(angle), elevation, Math.sin(angle)).normalize().multiplyScalar(13 + (i % 3) * 3);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTexture, color: i % 3 === 0 ? '#fff0ae' : '#ff7629', transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    }));
    root.add(sprite);
    return { sprite, velocity, phase: (i % 4) * .035, size: .65 + (i % 3) * .18 };
  });
  scene.add(root);
  let startedAt: number | undefined;

  return {
    trigger(position: SimState['position'], now: number) {
      root.position.set(position.x, position.y + 2.5, position.z);
      root.visible = true;
      startedAt = now;
      for (const { sprite } of smoke) sprite.visible = true;
      for (const { sprite } of sparks) sprite.visible = true;
    },
    update(now: number) {
      if (startedAt === undefined || !root.visible) return;
      const elapsed = now - startedAt;
      if (elapsed >= 4.2) {
        root.visible = false;
        startedAt = undefined;
        return;
      }
      const flashLife = Math.max(0, 1 - elapsed / 1.1);
      flash.visible = flashLife > 0;
      flash.position.y = 1 + Math.min(elapsed, 1.1) * 3;
      flash.scale.setScalar(4 + Math.min(elapsed, 1.1) * 22);
      flash.material.opacity = flashLife * flashLife;
      for (const puff of smoke) {
        const age = Math.max(0, elapsed - puff.phase - .12);
        const life = Math.max(0, 1 - age / 3.9);
        puff.sprite.position.y = 2 + age * (5.5 + puff.phase * 4);
        puff.sprite.scale.setScalar(puff.size + age * 4.5);
        puff.sprite.material.opacity = life * .62;
        puff.sprite.visible = life > .01;
      }
      for (const spark of sparks) {
        const age = Math.max(0, elapsed - spark.phase - .04);
        const life = Math.max(0, 1 - age / 1.05);
        spark.sprite.position.copy(spark.velocity).multiplyScalar(age);
        spark.sprite.position.y -= 4.9 * age * age;
        spark.sprite.scale.setScalar(spark.size * life);
        spark.sprite.material.opacity = life;
        spark.sprite.visible = life > .01;
      }
    },
  };
}

export function createScene(container: HTMLElement): {
  update(state: SimState, campaign: Campaign, mission: Mission): void;
  dispose(): void;
} {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b8d2d1');
  scene.fog = new THREE.Fog('#b8d2d1', 24_000, 128_000);
  scene.add(new THREE.HemisphereLight('#e4f0e8', '#637365', 2.25));
  const sun = new THREE.DirectionalLight('#fff0cf', 3.5);
  sun.position.set(-104, 160, -52);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 450;
  sun.shadow.bias = -.00025;
  sun.shadow.normalBias = .12;
  sun.shadow.radius = 2;
  scene.add(sun);
  scene.add(sun.target);
  const camera = new THREE.PerspectiveCamera(53, 1, .5, 210_000);
  const aircraft = new THREE.Group();
  scene.add(aircraft);
  const cameraAim = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  const cameraWant = new THREE.Vector3();
  const hudAnchor = new THREE.Vector3();
  const hudStyle = container.parentElement?.style;
  let latestState: SimState | undefined;
  let latestCampaign: Campaign | undefined;
  let latestMission: Mission | undefined;
  let world: ReturnType<typeof createWorld> | undefined;
  let vehicle: ReturnType<typeof createAircraft> | undefined;
  let bucketRig: ReturnType<typeof createBucketRig> | undefined;
  let groundCrew: ReturnType<typeof createGroundCrew> | undefined;
  let fire: ReturnType<typeof createFire> | undefined;
  let crashEffect: ReturnType<typeof createCrashEffect> | undefined;
  let clock = 0;
  let raf = 0;
  let firstFrame = true;
  let dropFraming = 0;
  let disposed = false;
  let previousPhase: SimState['phase'] | undefined;
  let previousOutcome: SimState['outcome'] | undefined;

  const onResize = () => {
    if (!container.clientWidth || !container.clientHeight) return;
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
  };
  const resize = new ResizeObserver(onResize);
  resize.observe(container);
  onResize();

  const renderFrame = () => {
    if (disposed) return;
    const delta = Math.min(.06, clock ? performance.now() / 1000 - clock : .016);
    clock = performance.now() / 1000;
    crashEffect?.update(clock);
    if (latestState && vehicle && latestCampaign && latestMission && fire && bucketRig && world) {
      const t = latestState.timeSec;
      const pos = latestState.position;
      aircraft.position.set(pos.x, pos.y, pos.z);
      aircraft.rotation.set(-latestState.pitch, latestState.heading, latestState.bank, 'YXZ');
      const crashed = latestState.phase === 'failed' &&
        (latestState as SimState & { failureCause?: string }).failureCause === 'collision';
      const slowRotor = latestState.phase === 'prepare' || latestState.phase === 'deck_rig' || latestState.phase === 'land';
      vehicle.rotors.forEach(r => {
        if (!crashed) r.rotation.y += delta * (slowRotor ? 4 : 52) * Number(r.userData.spin || 1);
        const disc = r.userData.disc as THREE.Mesh;
        const discMaterial = disc.material as THREE.MeshBasicMaterial;
        disc.visible = !crashed;
        discMaterial.opacity = slowRotor ? .38 : .92;
        (r.userData.blades as THREE.Mesh[]).forEach(blade => {
          const mat = blade.material as THREE.MeshStandardMaterial;
          // At flight RPM, a distinct blade mesh freezes into long dark rods
          // in screenshots. The swept disc carries the high-speed rotor cue.
          blade.visible = !crashed && slowRotor;
          mat.opacity = slowRotor ? 1 : 0;
          mat.depthWrite = slowRotor;
        });
      });
      const heat = clamp((latestState.fireHeat + latestState.peatHeat * .35) / 100, 0, 1);
      const burning = latestState.fireState === 'burning' || latestState.fireState === 'surface_suppressed' || latestState.fireState === 'being_secured';
      fire.update(t, heat * 100, burning, latestMission.wind, camera);
      bucketRig.update(latestState, latestCampaign, latestMission);
      groundCrew?.update(latestState);

      // Chase camera sits behind the nose, elevated enough to read the sling and approach.
      const heading = latestState.heading;
      // A narrow portrait viewport needs more distance to keep the full rotor span in frame.
      const framing = clamp(.85 / Math.max(.45, camera.aspect), 1, 1.85);
      const waterState = latestState as ExtendedSimState;
      const releasing = waterState.dumping || waterState.waterPackets?.length > 0;
      dropFraming += ((releasing ? 1 : 0) - dropFraming) * (1 - Math.exp(-delta * 2));
      const chase = new THREE.Vector3(0, (19 + Math.max(0, pos.y) * .035) * framing, (44 + dropFraming * 8) * framing);
      chase.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      cameraWant.set(pos.x + chase.x, pos.y + chase.y, pos.z + chase.z);
      // Keep the 22 m sling load inside the chase view during flight. Ease the
      // look target so rigging and recovery do not snap the camera vertically.
      cameraAim.set(pos.x, pos.y + (latestState.bucketAttached ? -17 - dropFraming * 8 : 4), pos.z)
        .add(new THREE.Vector3(0, 0, -13).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading));
      if (firstFrame) {
        camera.position.copy(cameraWant);
        cameraLook.copy(cameraAim);
        firstFrame = false;
      } else camera.position.lerp(cameraWant, 1 - Math.exp(-delta * 2.6));
      if (!firstFrame) cameraLook.lerp(cameraAim, 1 - Math.exp(-delta * 2.6));
      camera.lookAt(cameraLook);
      // A gentle widening above the working altitude reveals more of the
      // receding terrain. Keep the landing/dipping view and near bucket stable.
      const heightAboveGround = Math.max(0, pos.y - world.terrainHeight(pos.x, pos.z));
      const altitudeFraming = THREE.MathUtils.smoothstep(heightAboveGround, 80, 320) * 3;
      camera.fov = clamp(53 + Math.hypot(latestState.velocity.x, latestState.velocity.z) * .022 + altitudeFraming, 53, 62);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      // Project below the rear landing gear so the load meter follows the Chinook.
      hudAnchor.set(0, -2.6, 6.4);
      aircraft.localToWorld(hudAnchor);
      hudAnchor.project(camera);
      hudStyle?.setProperty('--aircraft-hud-x', `${(hudAnchor.x * .5 + .5) * container.clientWidth}px`);
      hudStyle?.setProperty('--aircraft-hud-y', `${(-hudAnchor.y * .5 + .5) * container.clientHeight + 12}px`);
      hudStyle?.setProperty('--aircraft-hud-visible', Math.abs(hudAnchor.x) < .95 && Math.abs(hudAnchor.y) < .92 && hudAnchor.z < 1 ? '1' : '0');
      sun.target.position.set(pos.x, pos.y - 6, pos.z);
      sun.position.copy(sun.target.position).add(new THREE.Vector3(-104, 160, -52));
      world.update(t, camera.position, latestState);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(renderFrame);
  };
  raf = requestAnimationFrame(renderFrame);

  const disposeTree = (root: THREE.Object3D) => {
    root.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      const disposeMaterial = (material: THREE.Material) => {
        const textured = material as THREE.Material & { map?: THREE.Texture | null; roughnessMap?: THREE.Texture | null };
        textured.map?.dispose();
        textured.roughnessMap?.dispose();
        material.dispose();
      };
      if (Array.isArray(mat)) mat.forEach(disposeMaterial); else if (mat) disposeMaterial(mat);
    });
  };
  const clearCampaign = () => {
    if (vehicle) {
      aircraft.remove(vehicle.root);
      disposeTree(vehicle.root);
      vehicle = undefined;
    }
    world?.dispose();
    world = undefined;
    bucketRig = undefined;
    groundCrew = undefined;
    fire = undefined;
    crashEffect = undefined;
    previousPhase = undefined;
    previousOutcome = undefined;
    aircraft.rotation.set(0, 0, 0);
    // Remove and dispose every theatre object while keeping renderer-wide lighting and the aircraft anchor.
    const keep = new Set<THREE.Object3D>([sun, sun.target, ...scene.children.filter(o => o instanceof THREE.HemisphereLight), aircraft]);
    for (const child of [...scene.children]) {
      if (!keep.has(child)) {
        scene.remove(child);
        disposeTree(child);
      }
    }
  };

  return {
    update(state, campaign, mission) {
      const campaignChanged = !latestCampaign || latestCampaign.id !== campaign.id || !latestMission || latestMission.id !== mission.id;
      if (campaignChanged) {
        clearCampaign();
        latestCampaign = campaign;
        latestMission = mission;
        world = createWorld(scene, campaign, mission);
        createShip(scene, campaign, mission);
        vehicle = createAircraft(campaign);
        aircraft.add(vehicle.root);
        bucketRig = createBucketRig(scene);
        groundCrew = createGroundCrew(scene, campaign, mission);
        fire = createFire(scene, mission, world.terrainHeight);
        crashEffect = createCrashEffect(scene);
        createHeightFog(campaign.id === 'jp_ketapang_2026_09').apply(scene);
        firstFrame = true;
        dropFraming = 0;
      } else {
        const wasFailed = previousPhase === 'failed' || previousOutcome === 'failed';
        const isFailed = state.phase === 'failed' || state.outcome === 'failed';
        const failureCause = (state as SimState & { failureCause?: string }).failureCause;
        if (!wasFailed && isFailed && failureCause === 'collision') {
          crashEffect?.trigger(state.position, performance.now() / 1000);
        }
      }
      previousPhase = state.phase;
      previousOutcome = state.outcome;
      latestState = state;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      clearCampaign();
      renderer.dispose();
      renderer.domElement.remove();
      hudStyle?.setProperty('--aircraft-hud-visible', '0');
    },
  };
}
