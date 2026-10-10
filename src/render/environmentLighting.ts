import * as THREE from 'three';
import { PMREMGenerator } from 'three';
import type { TimeOfDayEvaluation } from './timeOfDay';

type SkyPalette = {
  name: string;
  zenith: readonly [number, number, number];
  horizon: readonly [number, number, number];
  sun: readonly [number, number, number];
  sunDirection: readonly [number, number, number];
};

// These small authored palettes represent the same broad sky colour changes as
// timeOfDay.ts. The scene's sun and ambient lights still carry their exact
// simulation-time values; the PMREM maps only soften and colour reflections.
const PALETTES: readonly SkyPalette[] = [
  { name: 'night', zenith: [.027,.038,.066], horizon: [.043,.052,.073], sun: [.30,.32,.43], sunDirection: [.82,-.04,.57] },
  { name: 'dawn', zenith: [.052,.056,.074], horizon: [.085,.068,.062], sun: [.46,.34,.27], sunDirection: [.96,.12,.28] },
  { name: 'day', zenith: [.078,.112,.146], horizon: [.095,.115,.112], sun: [.51,.48,.40], sunDirection: [.78,.66,.48] },
  { name: 'dusk', zenith: [.056,.052,.070], horizon: [.087,.067,.060], sun: [.46,.33,.26], sunDirection: [-.96,.12,.28] },
];

export type EnvironmentLighting = {
  /** Apply authored simulation-time lighting without rendering another PMREM. */
  update(lighting: TimeOfDayEvaluation): void;
  /** Release all prefiltered environment targets and restore the prior scene map. */
  dispose(): void;
};

function makeSky(palette: SkyPalette): { scene: THREE.Scene; geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial } {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(10, 24, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms: {
      zenith: { value: new THREE.Vector3(...palette.zenith) },
      horizon: { value: new THREE.Vector3(...palette.horizon) },
      sun: { value: new THREE.Vector3(...palette.sun) },
      sunDirection: { value: new THREE.Vector3(Math.hypot(palette.sunDirection[0], palette.sunDirection[2]), palette.sunDirection[1], 0).normalize() },
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        skyDirection = normalize(worldPosition.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sun;
      uniform vec3 sunDirection;
      varying vec3 skyDirection;
      void main() {
        vec3 direction = normalize(skyDirection);
        float upper = smoothstep(-0.08, 0.42, direction.y);
        vec3 lowerHorizon = horizon * 0.72;
        vec3 sky = mix(lowerHorizon, mix(horizon, zenith, upper), smoothstep(-0.42, 0.02, direction.y));
        float sunDot = max(dot(direction, normalize(sunDirection)), 0.0);
        float halo = pow(sunDot, 28.0) * 0.12 + pow(sunDot, 260.0) * 0.44;
        gl_FragColor = vec4(sky + sun * halo, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, geometry, material };
}

/** Continuous weights; dawn/dusk exchange only where twilight contributes zero. */
export function environmentPaletteWeights(lighting: TimeOfDayEvaluation): [number, number, number, number] {
  const daylight = 1 - THREE.MathUtils.clamp(lighting.nightStrength, 0, 1);
  const day = daylight * THREE.MathUtils.smoothstep(lighting.sunDirection[1], .04, .35);
  const twilight = daylight - day;
  return [1 - daylight, lighting.sunDirection[0] >= 0 ? twilight : 0, day,
    lighting.sunDirection[0] < 0 ? twilight : 0];
}

/** Prefilter once, then blend the linear CubeUV atlases when lighting changes.
 * This costs one flat pass, with no cube captures or repeated PMREM filtering.
 */
export function createEnvironmentLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene): EnvironmentLighting {
  const priorEnvironment = scene.environment;
  const priorIntensity = scene.environmentIntensity;
  const priorRotation = scene.environmentRotation.clone();
  const targets: THREE.WebGLRenderTarget[] = [];
  const environments: THREE.Texture[] = [];
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  try {
    for (const palette of PALETTES) {
      const sky = makeSky(palette);
      try {
        const target = pmrem.fromScene(sky.scene, .018, .1, 20);
        targets.push(target);
        environments.push(target.texture);
      } finally {
        sky.geometry.dispose();
        sky.material.dispose();
      }
    }
  } catch (error) {
    for (const target of targets) target.dispose();
    pmrem.dispose();
    throw error;
  }
  pmrem.dispose();

  const blended = targets[0].clone();
  blended.depthBuffer = false;
  blended.scissorTest = false;
  blended.viewport.set(0, 0, blended.width, blended.height);
  blended.scissor.copy(blended.viewport);
  const blendScene = new THREE.Scene();
  const blendCamera = new THREE.Camera();
  const blendGeometry = new THREE.PlaneGeometry(2, 2);
  const weights = new THREE.Vector4();
  const blendMaterial = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    uniforms: {
      night: { value: environments[0] }, dawn: { value: environments[1] },
      day: { value: environments[2] }, dusk: { value: environments[3] },
      weights: { value: weights },
    },
    vertexShader: `varying vec2 atlasUv;
      void main() { atlasUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 atlasUv;
      uniform sampler2D night, dawn, day, dusk;
      uniform vec4 weights;
      void main() {
        gl_FragColor = texture2D(night, atlasUv) * weights.x
          + texture2D(dawn, atlasUv) * weights.y
          + texture2D(day, atlasUv) * weights.z
          + texture2D(dusk, atlasUv) * weights.w;
      }`,
  });
  const quad = new THREE.Mesh(blendGeometry, blendMaterial);
  quad.frustumCulled = false;
  blendScene.add(quad);
  const priorViewport = new THREE.Vector4();
  const priorScissor = new THREE.Vector4();
  let disposed = false;
  let lastWeights: number[] | undefined;
  const update = (lighting: TimeOfDayEvaluation) => {
    if (disposed) return;
    const next = environmentPaletteWeights(lighting);
    // Sub-perceptual weight steps avoid even this small pass on static/paused
    // frames while keeping transitions deterministic in simulation time.
    if (!lastWeights || next.some((weight, i) => Math.abs(weight - lastWeights![i]) >= 1 / 512)) {
      weights.fromArray(next);
      const priorTarget = renderer.getRenderTarget();
      const priorFace = renderer.getActiveCubeFace();
      const priorMip = renderer.getActiveMipmapLevel();
      renderer.getViewport(priorViewport);
      renderer.getScissor(priorScissor);
      const priorScissorTest = renderer.getScissorTest();
      const priorXr = renderer.xr.enabled;
      const priorAutoClear = renderer.autoClear;
      try {
        renderer.xr.enabled = false;
        renderer.autoClear = false;
        renderer.setRenderTarget(blended);
        renderer.render(blendScene, blendCamera);
        lastWeights = next;
      } finally {
        renderer.setRenderTarget(priorTarget, priorFace, priorMip);
        renderer.setViewport(priorViewport);
        renderer.setScissor(priorScissor);
        renderer.setScissorTest(priorScissorTest);
        renderer.xr.enabled = priorXr;
        renderer.autoClear = priorAutoClear;
      }
    }
    scene.environment = blended.texture;
    scene.environmentIntensity = THREE.MathUtils.clamp(.34 + lighting.ambientIntensity * .21, .46, .86);
    // Every palette has its highlight on +X, so one shared rotation follows
    // the real sun instead of interpolating highlights on opposing horizons.
    scene.environmentRotation.set(0, -Math.atan2(lighting.sunDirection[2], lighting.sunDirection[0]), 0);
  };

  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (scene.environment === blended.texture) {
        scene.environment = priorEnvironment;
        scene.environmentIntensity = priorIntensity;
        scene.environmentRotation.copy(priorRotation);
      }
      for (const target of targets) target.dispose();
      blended.dispose();
      blendGeometry.dispose();
      blendMaterial.dispose();
      blendScene.clear();
    },
  };
}
