import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import { evaluateTimeOfDay } from './timeOfDay';

function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function colorFromRgb(rgb: readonly [number, number, number]): THREE.Color {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]);
}

function hashGrid(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hashGrid(ix, iy, seed), b = hashGrid(ix + 1, iy, seed);
  const c = hashGrid(ix, iy + 1, seed), d = hashGrid(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

/** Deterministic, soft-edged cloud detail with a broken, wind-stretched silhouette. */
function cloudTexture(seed: number, wispy = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  const width = canvas.width, height = canvas.height;
  const smooth = (edge0: number, edge1: number, value: number) => {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  };
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = px / (width - 1), v = py / (height - 1);
      const broad = valueNoise(u * 4.5, v * (wispy ? 7 : 4.5), seed + 1);
      const medium = valueNoise(u * 10, v * (wispy ? 18 : 10), seed + 7);
      const fine = valueNoise(u * 22, v * (wispy ? 38 : 22), seed + 19);
      const detail = valueNoise(u * 46, v * (wispy ? 70 : 46), seed + 43);
      const field = broad * .46 + medium * .28 + fine * .17 + detail * .09;
      const dx = (u - .5) * (wispy ? 1.35 : 1.82);
      const dy = (v - .5) * (wispy ? 2.25 : 1.82);
      const envelope = Math.max(0, 1 - Math.hypot(dx, dy));
      const breakup = (field - .46) * (wispy ? .72 : .84);
      const mass = envelope * (wispy ? .52 : .73) + breakup;
      const alpha = smooth(wispy ? .19 : .20, wispy ? .38 : .40, mass);
      const striation = wispy ? .84 + .16 * valueNoise(u * 3.5, v * 26, seed + 61) : 1;
      const i = (py * width + px) * 4;
      const brightness = Math.round(226 + field * 29);
      image.data[i] = brightness;
      image.data[i + 1] = brightness;
      image.data[i + 2] = brightness;
      image.data[i + 3] = Math.round(alpha * striation * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type CloudLighting = {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  ambientColor: THREE.Color;
  sunIntensity: { value: number };
};

function makeCloudLayer(count: number, texture: THREE.Texture, opacity: number, fog: boolean, lighting: CloudLighting) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: '#ffffff',
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.cloudSunDirection = { value: lighting.sunDirection };
    shader.uniforms.cloudSunColor = { value: lighting.sunColor };
    shader.uniforms.cloudAmbientColor = { value: lighting.ambientColor };
    shader.uniforms.cloudSunIntensity = lighting.sunIntensity;
    shader.vertexShader = `
      varying vec2 vCloudUv;
      varying vec3 vCloudAxisX;
      varying vec3 vCloudAxisY;
      varying vec3 vCloudPlaneNormal;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vCloudUv = uv;
       mat3 cloudMatrix = mat3(modelMatrix * instanceMatrix);
       vCloudAxisX = normalize(cloudMatrix * vec3(1.0, 0.0, 0.0));
       vCloudAxisY = normalize(cloudMatrix * vec3(0.0, 1.0, 0.0));
       vCloudPlaneNormal = normalize(cross(vCloudAxisX, vCloudAxisY));`,
    );
    shader.fragmentShader = `
      uniform vec3 cloudSunDirection;
      uniform vec3 cloudSunColor;
      uniform vec3 cloudAmbientColor;
      uniform float cloudSunIntensity;
      varying vec2 vCloudUv;
      varying vec3 vCloudAxisX;
      varying vec3 vCloudAxisY;
      varying vec3 vCloudPlaneNormal;
    ` + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float cloudCenter = clamp(diffuseColor.a / max(opacity, 0.001), 0.0, 1.0);
       vec2 uvDx = dFdx(vCloudUv), uvDy = dFdy(vCloudUv);
       float alphaDx = dFdx(cloudCenter), alphaDy = dFdy(cloudCenter);
       float uvDet = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
       vec2 cloudSlope = vec2(0.0);
       if (abs(uvDet) > 0.00000001) {
         cloudSlope = vec2(alphaDx * uvDy.y - alphaDy * uvDx.y, alphaDy * uvDx.x - alphaDx * uvDy.x) / uvDet;
         cloudSlope = clamp(cloudSlope * 0.018, vec2(-0.72), vec2(0.72));
       }
       vec3 cloudNormal = normalize(-vCloudPlaneNormal - cloudSlope.x * vCloudAxisX - cloudSlope.y * vCloudAxisY);
       vec3 sunVector = normalize(cloudSunDirection);
       float cloudLight = max(dot(cloudNormal, sunVector), 0.0);
       float cloudBackScatter = max(dot(-cloudNormal, sunVector), 0.0) * (0.18 + cloudCenter * 0.12);
       float cloudLit = cloudLight + cloudBackScatter;
       float cloudRim = pow(clamp(cloudLight, 0.0, 1.0), 2.4);
       vec3 cloudFill = cloudAmbientColor * 0.74 + cloudSunColor * cloudSunIntensity * (0.10 + 0.26 * cloudLit);
       cloudFill += cloudSunColor * cloudSunIntensity * cloudRim * 0.10;
       cloudFill *= 1.0 - smoothstep(0.55, 0.96, cloudCenter) * 0.10;
       diffuseColor.rgb *= cloudFill;`,
    );
  };
  material.customProgramCacheKey = () => 'directional-cloud-lighting-v1';
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
  mesh.frustumCulled = false;
  return mesh;
}

/** Lightweight authored humid-tropical atmosphere; no date-specific weather assertion. */
export function createAtmosphere(scene: THREE.Scene, campaign: Campaign, mission: Mission, options: { preview?: boolean } = {}) {
  // Static overhead previews have no horizon, so a sky dome and cloud decks
  // only add work and can obscure the map. Keep the terrain lighting to the
  // preview renderer instead.
  if (options.preview) {
    scene.fog = null;
    return { update(_time?: number, _camera?: THREE.Vector3, _state?: SimState) {}, setQuality(_quality: 'high' | 'low') {}, dispose() {} };
  }

  const jp = campaign.id === 'jp_ketapang_2026_09';
  const initialTime = evaluateTimeOfDay(mission, 0);
  const horizonColor = colorFromRgb(initialTime.skyHorizon);
  scene.fog = new THREE.FogExp2(colorFromRgb(initialTime.fogColor), jp ? .00016 : .00013);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: colorFromRgb(initialTime.skyZenith) },
      horizon: { value: horizonColor },
      sunDirection: { value: new THREE.Vector3(...initialTime.sunDirection) },
      sunColor: { value: colorFromRgb(initialTime.sunColor) },
      sunVisibility: { value: THREE.MathUtils.smoothstep(initialTime.sunDirection[1], -.025, .03) },
    },
    vertexShader: 'varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      varying vec3 direction;
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float sunVisibility;
      void main() {
        vec3 d = normalize(direction);
        float upper = pow(max(d.y, 0.0), .48);
        vec3 skyColor = mix(horizon, zenith, upper);
        float hazeBand = exp(-max(d.y, 0.0) * 15.0);
        skyColor = mix(skyColor, horizon, hazeBand * .43);
        float sun = max(dot(d, sunDirection), 0.0) * sunVisibility;
        skyColor += sunColor * pow(sun, 15.0) * .09;
        skyColor += sunColor * pow(sun, 180.0) * .72;
        skyColor += sunColor * smoothstep(.99972, .99992, sun) * 1.7;
        gl_FragColor = vec4(skyColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  sky.renderOrder = -100;
  scene.add(sky);

  const lowTexture = cloudTexture(mission.seed + 303);
  const highTexture = cloudTexture(mission.seed + 1709, true);
  const makeCloudLighting = (): CloudLighting => ({
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(1, 1, 1),
    ambientColor: new THREE.Color(.7, .78, .84),
    sunIntensity: { value: 1 },
  });
  const lowCloudLighting = makeCloudLighting();
  const highCloudLighting = makeCloudLighting();
  const lowClouds = makeCloudLayer(48, lowTexture, .52, true, lowCloudLighting);
  const highClouds = makeCloudLayer(30, highTexture, .30, true, highCloudLighting);
  const lowCloudMaterial = lowClouds.material as THREE.MeshBasicMaterial;
  const highCloudMaterial = highClouds.material as THREE.MeshBasicMaterial;
  const lowDummy = new THREE.Object3D();
  const highDummy = new THREE.Object3D();
  const rand = seeded(mission.seed + 887);
  const centerX = mission.fire.x;
  const centerZ = mission.fire.z;

  // Cumulus fragments gather into broad, imperfect banks over and beyond the route.
  for (let i = 0; i < 48; i++) {
    const bank = Math.floor(i / 8);
    const angle = bank * 2.39996;
    const range = 1800 + (bank % 3) * 2100;
    const clusterX = centerX + Math.cos(angle) * range;
    const clusterZ = centerZ + Math.sin(angle) * range;
    lowDummy.position.set(clusterX + (rand() - .5) * 1050, 430 + rand() * 180, clusterZ + (rand() - .5) * 800);
    lowDummy.rotation.set(-Math.PI / 2 + (rand() - .5) * .08, 0, angle + (rand() - .5) * .3);
    lowDummy.scale.set(650 + rand() * 1050, 390 + rand() * 530, 1);
    lowDummy.updateMatrix();
    lowClouds.setMatrixAt(i, lowDummy.matrix);
    const shade = .82 + rand() * .18;
    lowClouds.setColorAt(i, new THREE.Color().setRGB(shade, shade * (jp ? .99 : 1), shade * .95));
  }

  // Thin upper streaks add a second depth cue while staying faint from the cockpit.
  for (let i = 0; i < 30; i++) {
    const angle = rand() * Math.PI * 2;
    const range = 1200 + rand() * 7000;
    highDummy.position.set(centerX + Math.cos(angle) * range, 1050 + rand() * 520, centerZ + Math.sin(angle) * range);
    highDummy.rotation.set(-Math.PI / 2 + (rand() - .5) * .035, 0, rand() * Math.PI);
    highDummy.scale.set(900 + rand() * 1700, 130 + rand() * 210, 1);
    highDummy.updateMatrix();
    highClouds.setMatrixAt(i, highDummy.matrix);
    const shade = .84 + rand() * .16;
    highClouds.setColorAt(i, new THREE.Color(shade, shade, shade));
  }
  lowClouds.instanceMatrix.needsUpdate = true;
  highClouds.instanceMatrix.needsUpdate = true;
  if (lowClouds.instanceColor) lowClouds.instanceColor.needsUpdate = true;
  if (highClouds.instanceColor) highClouds.instanceColor.needsUpdate = true;
  scene.add(lowClouds, highClouds);

  const wind = mission.wind;
  const ambientFog = scene.fog as THREE.FogExp2;
  const smokeFogColor = new THREE.Color('#aaa58d');
  const sunDirection = new THREE.Vector3();
  const sunColor = new THREE.Color();
  const ambientColor = new THREE.Color();
  const baseFogColor = new THREE.Color();
  const baselineDensity = ambientFog.density;
  const windLength = Math.max(.1, Math.hypot(wind.x, wind.z));
  const setQuality = (next: 'high' | 'low') => {
    lowClouds.count = next === 'high' ? 48 : 25;
    highClouds.count = next === 'high' ? 30 : 14;
  };
  return {
    setQuality,
    update(time: number, camera?: THREE.Vector3, state?: SimState) {
      if (camera) sky.position.copy(camera);
      const timeOfDay = evaluateTimeOfDay(mission, time);
      sunDirection.set(...timeOfDay.sunDirection);
      sunColor.setRGB(...timeOfDay.sunColor);
      ambientColor.setRGB(...timeOfDay.ambientColor);
      lowCloudLighting.sunDirection.copy(sunDirection);
      lowCloudLighting.sunColor.copy(sunColor);
      lowCloudLighting.ambientColor.copy(ambientColor);
      lowCloudLighting.sunIntensity.value = timeOfDay.sunIntensity / 3.5;
      highCloudLighting.sunDirection.copy(sunDirection);
      highCloudLighting.sunColor.copy(sunColor);
      highCloudLighting.ambientColor.copy(ambientColor);
      highCloudLighting.sunIntensity.value = timeOfDay.sunIntensity / 3.5;
      const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
      uniforms.zenith.value.setRGB(...timeOfDay.skyZenith);
      uniforms.horizon.value.setRGB(...timeOfDay.skyHorizon);
      uniforms.sunDirection.value.copy(sunDirection);
      uniforms.sunColor.value.copy(sunColor);
      uniforms.sunVisibility.value = THREE.MathUtils.smoothstep(timeOfDay.sunDirection[1], -.025, .03);
      lowCloudMaterial.color.setRGB(1, 1, 1);
      highCloudMaterial.color.setRGB(1, 1, 1);
      lowCloudMaterial.opacity = .53 - timeOfDay.nightStrength * .21;
      highCloudMaterial.opacity = .31 - timeOfDay.nightStrength * .13;
      baseFogColor.setRGB(...timeOfDay.fogColor);
      ambientFog.color.copy(baseFogColor);
      ambientFog.density = baselineDensity * (1 + timeOfDay.nightStrength * .28);
      const drift = Math.min(2600, Math.max(-2600, time * .34));
      lowClouds.position.set(wind.x * drift, 0, wind.z * drift);
      highClouds.position.set(wind.x * drift * .62, 0, wind.z * drift * .62);
      // Passing through the active downwind plume gently reduces contrast.
      // Suppression clears this local haze along with the visible smoke column.
      if (camera) {
        const dx = camera.x - mission.fire.x, dz = camera.z - mission.fire.z;
        const along = (dx * wind.x + dz * wind.z) / windLength;
        const across = (dx * -wind.z + dz * wind.x) / windLength;
        const width = mission.fire.radius * .65 + 35;
        const density = Math.exp(-Math.pow(across / width, 2)) *
          Math.exp(-Math.pow((along - 95) / (mission.fire.radius + 150), 2)) *
          Math.exp(-Math.pow((camera.y - 55) / 95, 2));
        const active = !state || state.fireState === 'burning' || state.fireState === 'surface_suppressed' || state.fireState === 'being_secured';
        const heat = active ? Math.min(1, (state?.fireHeat ?? 100) / 100) : 0;
        const smoke = density * heat;
        ambientFog.density += smoke * .0008;
        ambientFog.color.lerp(smokeFogColor, smoke * .42);
      }
    },
    dispose() {
      scene.remove(sky, lowClouds, highClouds);
      (sky.geometry as THREE.BufferGeometry).dispose();
      (sky.material as THREE.Material).dispose();
      lowClouds.geometry.dispose();
      highClouds.geometry.dispose();
      lowCloudMaterial.dispose();
      highCloudMaterial.dispose();
      lowTexture.dispose();
      highTexture.dispose();
      scene.fog = null;
    },
  };
}
