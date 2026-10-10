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
import { evaluateTimeOfDay } from './timeOfDay';
import { createNightLighting } from './nightLighting';
import { createProximityParticles } from './proximityParticles';
import { createCinematicEffects } from './cinematicEffects';
import { cinematicEffectsEnabled, onCinematicEffectsChange } from '../visualPreferences';
import { graphicsMode, onGraphicsModeChange } from '../visualPreferences';
import { AdaptiveQuality, qualityProfile, RenderCadence, scenePixelRatio } from './quality';
import type { GraphicsMode } from './quality';
import { createGpuTimer, estimateSceneBytes, FrameHistory } from './renderDiagnostics';
import { createEnvironmentLighting } from './environmentLighting';
import { createTextureAssets } from './textureAssets';

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

export type SceneCameraPose = {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
};

export type CreateSceneOptions = {
  /** Render only when renderFrame is called, using its supplied delta. */
  externalClock?: boolean;
  /** Override the renderer's device pixel ratio. */
  pixelRatio?: number;
  quality?: GraphicsMode;
};

export function createScene(container: HTMLElement, options: CreateSceneOptions = {}): {
  update(state: SimState, campaign: Campaign, mission: Mission): void;
  /** Render one frame. A supplied camera pose replaces the computed chase pose for this frame. */
  renderFrame(deltaSeconds: number, cameraPose?: SceneCameraPose): void;
  /** Use the application's frame scheduler without changing the simulation rate. */
  renderScheduledFrame(nowMs: number, paused: boolean): boolean;
  setQuality(mode: GraphicsMode): void;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
  diagnostics(): { calls: number; triangles: number; textures: number; geometries: number; frameMs: number;
    cpuSubmissionMs: number; gpuMs: number | null; estimatedSceneBytes: number; renderTargetBytes: number;
    frameIntervalP50Ms: number; frameIntervalP95Ms: number; samples: number; mode: GraphicsMode; qualityLevel: number;
    targetFps: number; pixelRatio: number; width: number; height: number;
    burnedTrees: number; charredTrees: number; damageTriangles: number };
} {
  const externalClock = options.externalClock ?? false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.info.autoReset = false;
  let lastFrameMs = 0;
  const mobileQuery = matchMedia('(max-width: 768px), (pointer: coarse)');
  let mode = options.quality ?? graphicsMode();
  const adaptive = new AdaptiveQuality();
  const cadence = new RenderCadence();
  const frameHistory = new FrameHistory();
  const gpuTimer = createGpuTimer(renderer);
  const textureAssets = createTextureAssets(renderer);
  let profile = qualityProfile(mode, mobileQuery.matches, adaptive.level);
  let renderDirty = true;
  let pauseStartedAt: number | undefined;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const environment = createEnvironmentLighting(renderer, scene);
  scene.background = new THREE.Color('#b8d2d1');
  scene.fog = new THREE.Fog('#b8d2d1', 24_000, 128_000);
  const ambient = new THREE.HemisphereLight('#e4f0e8', '#637365', 2.25);
  scene.add(ambient);
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
  let nightLighting: ReturnType<typeof createNightLighting> | undefined;
  let proximityParticles: ReturnType<typeof createProximityParticles> | undefined;
  const cinematic = createCinematicEffects(renderer);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let effectsEnabled = cinematicEffectsEnabled();
  const unsubscribeEffects = onCinematicEffectsChange(enabled => { effectsEnabled = enabled; });
  const cameraPrevious = new THREE.Vector3();
  const cameraVelocity = new THREE.Vector3();
  let previousSimTime = -1;
  let nightStrength = 0;
  let effectsPaused = true;
  let elapsedClock = 0;
  let renderTime = 0;
  let raf = 0;
  let firstFrame = true;
  let dropFraming = 0;
  let disposed = false;
  let previousPhase: SimState['phase'] | undefined;
  let previousOutcome: SimState['outcome'] | undefined;

  const onResize = () => {
    if (!container.clientWidth || !container.clientHeight) return;
    renderer.setPixelRatio(Number.isFinite(options.pixelRatio) && (options.pixelRatio ?? 0) > 0
      ? options.pixelRatio! : scenePixelRatio(container.clientWidth, container.clientHeight, window.devicePixelRatio, profile.renderScale));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    cinematic.resize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderDirty = true;
  };
  const applyQuality = () => {
    profile = qualityProfile(mode, mobileQuery.matches, adaptive.level);
    if (sun.shadow.mapSize.x !== profile.shadowSize) {
      sun.shadow.map?.dispose(); sun.shadow.map = null;
      sun.shadow.mapSize.setScalar(profile.shadowSize);
    }
    world?.setQuality(profile);
    fire?.setQuality(profile.detail);
    onResize();
  };
  const setQuality = (next: GraphicsMode) => {
    mode = next; adaptive.level = 0; adaptive.reset(); cadence.reset(); applyQuality();
  };
  const unsubscribeQuality = onGraphicsModeChange(setQuality);
  mobileQuery.addEventListener('change', applyQuality);
  const resize = new ResizeObserver(onResize);
  resize.observe(container);
  onResize();

  const drawFrame = (delta: number, cameraPose: SceneCameraPose | undefined, frameTime: number) => {
    if (disposed) return;
    const frameStart = performance.now();
    renderer.info.reset();
    renderTime = frameTime;
    crashEffect?.update(renderTime);
    if (latestState && vehicle && latestCampaign && latestMission && fire && bucketRig && world) {
      const t = latestState.timeSec;
      const simulationDelta = previousSimTime < 0 ? 0 : Math.max(0, Math.min(.1, t - previousSimTime));
      effectsPaused = simulationDelta === 0 || latestState.outcome !== 'none';
      previousSimTime = t;
      const daylight = evaluateTimeOfDay(latestMission, t);
      environment.update(daylight);
      nightStrength = daylight.nightStrength;
      sun.color.setRGB(...daylight.sunColor);
      sun.intensity = daylight.sunIntensity;
      sun.castShadow = daylight.sunIntensity > .05;
      ambient.color.setRGB(...daylight.ambientColor);
      ambient.groundColor.copy(ambient.color).multiplyScalar(.35);
      ambient.intensity = daylight.ambientIntensity * .72;
      cameraPrevious.copy(camera.position);
      const pos = latestState.position;
      aircraft.position.set(pos.x, pos.y, pos.z);
      aircraft.rotation.set(-latestState.pitch, latestState.heading, latestState.bank, 'YXZ');
      const crashed = latestState.phase === 'failed' &&
        (latestState as SimState & { failureCause?: string }).failureCause === 'collision';
      const slowRotor = latestState.phase === 'prepare' || latestState.phase === 'deck_rig' || latestState.phase === 'land';
      vehicle.rotors.forEach(r => {
        if (!crashed) r.rotation.y += simulationDelta * (slowRotor ? 4 : 52) * Number(r.userData.spin || 1);
        const disc = r.userData.disc as THREE.Mesh;
        const discMaterial = disc.material as THREE.MeshBasicMaterial;
        disc.visible = !crashed;
        discMaterial.opacity = slowRotor ? .25 : .64;
        (r.userData.blades as THREE.Mesh[]).forEach(blade => {
          const mat = blade.material as THREE.MeshStandardMaterial;
          // Keep the physical blades legible at flight RPM alongside the swept disc.
          // Simulation-time rotation freezes both elements consistently when paused.
          blade.visible = !crashed;
          mat.opacity = 1;
          mat.depthWrite = true;
        });
      });
      const heat = clamp((latestState.fireHeat + latestState.peatHeat * .35) / 100, 0, 1);
      const burning = latestState.fireState === 'burning' || latestState.fireState === 'surface_suppressed' || latestState.fireState === 'being_secured';
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
      // Capture callers can choose a stable view after the normal chase-camera
      // calculations. World and cinematic effects below then use this pose too.
      if (cameraPose) {
        camera.position.set(cameraPose.position.x, cameraPose.position.y, cameraPose.position.z);
        camera.lookAt(cameraPose.target.x, cameraPose.target.y, cameraPose.target.z);
        if (cameraPose.fov !== undefined) {
          camera.fov = cameraPose.fov;
          camera.updateProjectionMatrix();
        }
      }
      camera.updateMatrixWorld();
      fire.update(t, heat * 100, burning, latestMission.wind, camera, latestState);
      // Project below the rear landing gear so the load meter follows the Chinook.
      hudAnchor.set(0, -2.6, 6.4);
      aircraft.localToWorld(hudAnchor);
      hudAnchor.project(camera);
      hudStyle?.setProperty('--aircraft-hud-x', `${(hudAnchor.x * .5 + .5) * container.clientWidth}px`);
      hudStyle?.setProperty('--aircraft-hud-y', `${(-hudAnchor.y * .5 + .5) * container.clientHeight + 12}px`);
      hudStyle?.setProperty('--aircraft-hud-visible', Math.abs(hudAnchor.x) < .95 && Math.abs(hudAnchor.y) < .92 && hudAnchor.z < 1 ? '1' : '0');
      sun.target.position.set(pos.x, pos.y - 6, pos.z);
      sun.position.set(...daylight.sunDirection).multiplyScalar(200).add(sun.target.position);
      cameraVelocity.copy(camera.position).sub(cameraPrevious).multiplyScalar(simulationDelta > 0 ? 1 / simulationDelta : 0);
      nightLighting?.update(latestState, nightStrength, daylight.sunIntensity);
      proximityParticles?.update(latestState, camera);
      world.update(t, camera.position, latestState, nightStrength);
    }
    if (latestState) cinematic.render(scene, camera, {
      enabled: effectsEnabled && profile.cinematic, reducedMotion: reducedMotion.matches, paused: effectsPaused,
      nightStrength, isPhone: container.clientWidth < 768,
      aircraftPosition: latestState.position,
      bucketPosition: latestState.bucketAttached ? latestState.bucket : undefined,
      velocity: latestState.velocity, cameraVelocity,
    });
    else renderer.render(scene, camera);
    lastFrameMs = performance.now() - frameStart;
  };
  const renderFrame = (deltaSeconds: number, cameraPose?: SceneCameraPose) => {
    if (disposed) return;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    elapsedClock += delta;
    gpuTimer.begin();
    try { drawFrame(delta, cameraPose, externalClock ? elapsedClock : performance.now() / 1000); }
    finally { gpuTimer.end(); }
  };
  const renderScheduledFrame = (now: number, paused: boolean) => {
    if (disposed || document.hidden) { cadence.reset(); adaptive.reset(); return false; }
    if (paused) pauseStartedAt ??= now;
    else if (pauseStartedAt !== undefined) {
      pauseStartedAt = undefined;
      cadence.reset();
      adaptive.reset();
    }
    const settling = paused && now - (pauseStartedAt ?? now) < (latestState?.phase === 'failed' ? 4500 : 250);
    if (renderDirty) cadence.reset();
    const delta = cadence.take(now, paused && !settling && !renderDirty ? 2 : profile.targetFps);
    if (delta === null) return false;
    renderFrame(delta);
    renderDirty = false;
    if (!paused) {
      frameHistory.add(delta * 1000);
      if (mode === 'auto' && adaptive.observe(delta * 1000, lastFrameMs, gpuTimer.milliseconds, profile.targetFps)) applyQuality();
    } else adaptive.reset();
    return true;
  };
  const renderRafFrame = () => {
    if (disposed) return;
    renderScheduledFrame(performance.now(), false);
    if (!disposed) raf = requestAnimationFrame(renderRafFrame);
  };
  if (!externalClock) raf = requestAnimationFrame(renderRafFrame);

  const disposeTree = (root: THREE.Object3D) => {
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    root.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
      if (mesh.geometry) geometries.add(mesh.geometry);
      const mat = mesh.material;
      const disposeMaterial = (material: THREE.Material) => {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        const uniforms = (material as THREE.ShaderMaterial).uniforms;
        if (uniforms) for (const uniform of Object.values(uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      };
      if (Array.isArray(mat)) mat.forEach(disposeMaterial); else if (mat) disposeMaterial(mat);
    });
    for (const texture of textures) if (!texture.userData.sharedAsset && texture !== scene.environment) texture.dispose();
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
  };
  const clearCampaign = () => {
    nightLighting?.dispose(); nightLighting = undefined;
    proximityParticles?.dispose(); proximityParticles = undefined;
    previousSimTime = -1;
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
    get canvas() { return renderer.domElement; },
    diagnostics() { return {
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries, frameMs: lastFrameMs, cpuSubmissionMs: lastFrameMs,
      gpuMs: gpuTimer.milliseconds, estimatedSceneBytes: estimateSceneBytes(scene), renderTargetBytes: cinematic.estimatedBytes(),
      ...frameHistory.read(), mode, qualityLevel: adaptive.level, targetFps: profile.targetFps,
      pixelRatio: renderer.getPixelRatio(), width: renderer.domElement.width, height: renderer.domElement.height,
      burnedTrees: world?.vegetationStats.burnedTrees ?? 0,
      charredTrees: world?.vegetationStats.charredTrees ?? 0,
      damageTriangles: world?.vegetationStats.damageTriangles ?? 0,
    }; },
    renderFrame,
    renderScheduledFrame,
    setQuality,
    update(state, campaign, mission) {
      const campaignChanged = !latestCampaign || latestCampaign.id !== campaign.id || !latestMission || latestMission.id !== mission.id;
      if (campaignChanged) {
        clearCampaign();
        latestCampaign = campaign;
        latestMission = mission;
        world = createWorld(scene, campaign, mission, { textureAssets });
        createShip(scene, campaign, mission);
        vehicle = createAircraft(campaign);
        aircraft.add(vehicle.root);
        nightLighting = createNightLighting(scene, aircraft, campaign, mission, vehicle.lightMounts, world.coastalLightingAnchor);
        proximityParticles = createProximityParticles(scene, campaign, mission);
        bucketRig = createBucketRig(scene);
        groundCrew = createGroundCrew(scene, campaign, mission);
        fire = createFire(scene, mission, world.terrainHeight, world.burnField);
        crashEffect = createCrashEffect(scene);
        createHeightFog(campaign.id === 'jp_ketapang_2026_09').apply(scene);
        applyQuality();
        adaptive.reset(); cadence.reset(); renderDirty = true;
        firstFrame = true;
        dropFraming = 0;
      } else {
        const wasFailed = previousPhase === 'failed' || previousOutcome === 'failed';
        const isFailed = state.phase === 'failed' || state.outcome === 'failed';
        const failureCause = (state as SimState & { failureCause?: string }).failureCause;
        if (!wasFailed && isFailed && failureCause === 'collision') {
          crashEffect?.trigger(state.position, externalClock ? elapsedClock : performance.now() / 1000);
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
      unsubscribeEffects();
      unsubscribeQuality(); mobileQuery.removeEventListener('change', applyQuality);
      cinematic.dispose();
      textureAssets.dispose();
      environment.dispose();
      gpuTimer.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      hudStyle?.setProperty('--aircraft-hud-visible', '0');
    },
  };
}
