import * as THREE from 'three';

export type WorldPoint = Readonly<{ x: number; y: number; z: number }>;

export type CinematicEffectOptions = {
  enabled: boolean;
  reducedMotion: boolean;
  paused: boolean;
  /** 0 is daylight and 1 is full night. */
  nightStrength: number;
  isPhone: boolean;
  aircraftPosition: WorldPoint;
  bucketPosition?: WorldPoint;
  /** Aircraft velocity in world metres per second. */
  velocity: WorldPoint;
  /** Optional camera velocity in world metres per second. */
  cameraVelocity?: WorldPoint;
};

export type CinematicEffectStrengths = {
  vignette: number;
  edgeBlurCssPixels: number;
  motionBlurCssPixels: number;
  motionBlend: number;
};

const clamp = THREE.MathUtils.clamp;
const smoothstep = THREE.MathUtils.smoothstep;

/** Pure strength calculation so effect limits stay testable without WebGL. */
export function getCinematicEffectStrengths(
  options: CinematicEffectOptions,
  out: CinematicEffectStrengths = { vignette: 0, edgeBlurCssPixels: 0, motionBlurCssPixels: 0, motionBlend: 0 },
): CinematicEffectStrengths {
  if (!options.enabled) {
    out.vignette = 0;
    out.edgeBlurCssPixels = 0;
    out.motionBlurCssPixels = 0;
    out.motionBlend = 0;
    return out;
  }
  const night = clamp(options.nightStrength, 0, 1);
  const speedKmh = Math.hypot(options.velocity.x, options.velocity.z) * 3.6;
  const motion = options.reducedMotion || options.paused ? 0 : smoothstep(speedKmh, 40, 100);
  const motionCap = options.isPhone ? .75 : 1.5;
  out.vignette = THREE.MathUtils.lerp(.08, .05, night);
  out.edgeBlurCssPixels = options.isPhone ? .75 : 1.25;
  out.motionBlurCssPixels = motionCap * motion;
  out.motionBlend = .075 * motion;
  return out;
}

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform float uVignette;
  uniform float uEdgeBlurCssPixels;
  uniform float uMotionBlurCssPixels;
  uniform float uMotionBlend;
  uniform vec2 uMotionDirection;
  uniform vec2 uAircraftUv;
  uniform vec2 uBucketUv;
  uniform float uAircraftVisible;
  uniform float uBucketVisible;
  varying vec2 vUv;

  float focusMask(vec2 pixel, vec2 focusUv, float visible, float radius, float softness) {
    float distanceToFocus = length(pixel - focusUv * uResolution) / uPixelRatio;
    return visible * (1.0 - smoothstep(radius, radius + softness, distanceToFocus));
  }

  void main() {
    vec2 pixel = vUv * uResolution;
    vec2 fromCenterCss = (pixel - .5 * uResolution) / uPixelRatio;
    float minDimensionCss = min(uResolution.x, uResolution.y) / uPixelRatio;
    float radius = length(fromCenterCss) / max(1.0, minDimensionCss);
    float edge = smoothstep(.325, .78, radius);
    float vignette = smoothstep(.2, .9, radius) * uVignette;

    float aircraftMask = focusMask(pixel, uAircraftUv, uAircraftVisible, 58.0, 20.0);
    float bucketMask = focusMask(pixel, uBucketUv, uBucketVisible, 25.0, 10.0);
    float protectedArea = max(aircraftMask, bucketMask);

    vec2 radialDirection = normalize(fromCenterCss + vec2(.0001, .0001));
    vec2 motionDirection = length(uMotionDirection) > .001
      ? normalize(uMotionDirection)
      : radialDirection;
    vec2 blurDirection = normalize(mix(radialDirection, motionDirection,
      smoothstep(.01, .16, uMotionBlurCssPixels)));
    float edgeRadius = uEdgeBlurCssPixels * edge;
    float motionRadius = uMotionBlurCssPixels * edge;
    float blurRadiusCss = edgeRadius + motionRadius;
    float blurMix = clamp(edge * (.28 + uMotionBlend), 0.0, .36) * (1.0 - protectedArea);
    vec2 sampleStep = blurDirection * blurRadiusCss * uPixelRatio / uResolution;

    vec4 center = texture2D(tDiffuse, vUv);
    vec4 color = center * .30;
    color += texture2D(tDiffuse, vUv + sampleStep) * .23;
    color += texture2D(tDiffuse, vUv - sampleStep) * .23;
    color += texture2D(tDiffuse, vUv + sampleStep * .5) * .12;
    color += texture2D(tDiffuse, vUv - sampleStep * .5) * .12;
    color = mix(center, color, blurMix);
    color.rgb *= 1.0 - vignette;
    gl_FragColor = color;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** One low-cost scene-only postprocess pass. DOM HUD content stays untouched. */
export function createCinematicEffects(renderer: THREE.WebGLRenderer): {
  render(scene: THREE.Scene, camera: THREE.Camera, options: CinematicEffectOptions): void;
  resize(widthCssPixels: number, heightCssPixels: number): void;
  estimatedBytes(): number;
  dispose(): void;
} {
  let target: THREE.WebGLRenderTarget | undefined;
  let material: THREE.ShaderMaterial | undefined;
  let quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
  let available = true;
  let disposed = false;
  let pixelRatio = renderer.getPixelRatio();
  const resolution = new THREE.Vector2(1, 1);
  const motionDirection = new THREE.Vector2();
  const projectedStart = new THREE.Vector3();
  const projectedEnd = new THREE.Vector3();
  const relativeVelocity = new THREE.Vector3();
  const focusAircraft = new THREE.Vector2(-10, -10);
  const focusBucket = new THREE.Vector2(-10, -10);
  const strengthsScratch: CinematicEffectStrengths = {
    vignette: 0,
    edgeBlurCssPixels: 0,
    motionBlurCssPixels: 0,
    motionBlend: 0,
  };
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passScene = new THREE.Scene();

  try {
    target = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: 2,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: target.texture },
        uResolution: { value: resolution },
        uPixelRatio: { value: pixelRatio },
        uVignette: { value: 0 },
        uEdgeBlurCssPixels: { value: 0 },
        uMotionBlurCssPixels: { value: 0 },
        uMotionBlend: { value: 0 },
        uMotionDirection: { value: motionDirection },
        uAircraftUv: { value: focusAircraft },
        uBucketUv: { value: focusBucket },
        uAircraftVisible: { value: 0 },
        uBucketVisible: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    quad = new THREE.Mesh(geometry, material);
    quad.frustumCulled = false;
    passScene.add(quad);
  } catch {
    available = false;
    target?.dispose();
    material?.dispose();
    quad?.geometry.dispose();
  }

  const projectFocus = (point: WorldPoint | undefined, camera: THREE.Camera, uniform: THREE.Vector2, visibleUniform: { value: number }) => {
    if (!point) {
      visibleUniform.value = 0;
      uniform.set(-10, -10);
      return;
    }
    projectedStart.set(point.x, point.y, point.z).project(camera);
    visibleUniform.value = projectedStart.z >= -1 && projectedStart.z <= 1 ? 1 : 0;
    uniform.set(projectedStart.x * .5 + .5, projectedStart.y * .5 + .5);
  };

  return {
    estimatedBytes() { return target ? target.width * target.height * (8 + 4) * (target.samples + 1) : 0; },
    resize(widthCssPixels, heightCssPixels) {
      if (!available || disposed || !target || widthCssPixels <= 0 || heightCssPixels <= 0) return;
      pixelRatio = renderer.getPixelRatio();
      if (material) material.uniforms.uPixelRatio.value = pixelRatio;
      const width = Math.max(1, Math.round(widthCssPixels * pixelRatio));
      const height = Math.max(1, Math.round(heightCssPixels * pixelRatio));
      const previousTarget = renderer.getRenderTarget();
      try {
        target.setSize(width, height);
        renderer.setRenderTarget(target);
        const gl = renderer.getContext();
        available = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        resolution.set(width, height);
      } catch { available = false; }
      finally { renderer.setRenderTarget(previousTarget); }
    },
    render(scene, camera, options) {
      if (disposed) return;
      if (!available || !options.enabled) {
        renderer.render(scene, camera);
        return;
      }
      if (!target || !material || !quad) {
        renderer.render(scene, camera);
        return;
      }

      const strengths = getCinematicEffectStrengths(options, strengthsScratch);
      projectFocus(options.aircraftPosition, camera, focusAircraft, material.uniforms.uAircraftVisible);
      projectFocus(options.bucketPosition, camera, focusBucket, material.uniforms.uBucketVisible);

      relativeVelocity.set(
        options.velocity.x - (options.cameraVelocity?.x ?? 0),
        options.velocity.y - (options.cameraVelocity?.y ?? 0),
        options.velocity.z - (options.cameraVelocity?.z ?? 0),
      );
      projectedStart.set(options.aircraftPosition.x, options.aircraftPosition.y, options.aircraftPosition.z).project(camera);
      projectedEnd.set(
        options.aircraftPosition.x + relativeVelocity.x * .1,
        options.aircraftPosition.y + relativeVelocity.y * .1,
        options.aircraftPosition.z + relativeVelocity.z * .1,
      ).project(camera);
      motionDirection.set(
        (projectedEnd.x - projectedStart.x) * .5 * resolution.x,
        (projectedEnd.y - projectedStart.y) * .5 * resolution.y,
      );
      if (motionDirection.lengthSq() > .0001) motionDirection.normalize();

      material.uniforms.uVignette.value = strengths.vignette;
      material.uniforms.uEdgeBlurCssPixels.value = strengths.edgeBlurCssPixels;
      material.uniforms.uMotionBlurCssPixels.value = strengths.motionBlurCssPixels;
      material.uniforms.uMotionBlend.value = strengths.motionBlend;

      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
      renderer.clear();
      renderer.render(passScene, ortho);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target?.dispose();
      material?.dispose();
      quad?.geometry.dispose();
      passScene.clear();
    },
  };
}
