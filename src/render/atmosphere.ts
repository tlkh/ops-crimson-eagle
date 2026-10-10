import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import { evaluateTimeOfDay } from './timeOfDay';

function colorFromRgb(rgb: readonly [number, number, number]): THREE.Color {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]);
}

function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** A soft, broken cloud silhouette with enough internal variation to avoid a repeated disc. */
function cloudTexture(seed: number, wispy = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rand = seeded(seed);
  const blobs = wispy ? 30 : 15;
  for (let i = 0; i < blobs; i++) {
    const x = 32 + rand() * 192;
    const y = 43 + rand() * 170;
    const rx = (wispy ? 15 : 25) + rand() * (wispy ? 27 : 38);
    const ry = (wispy ? 4 : 16) + rand() * (wispy ? 10 : 25);
    const alpha = (wispy ? .10 : .075) + rand() * (wispy ? .12 : .16);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const gradient = ctx.createRadialGradient(0, 0, .025, 0, 0, 1);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(.56, `rgba(255,255,255,${alpha * .76})`);
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

function makeCloudLayer(count: number, texture: THREE.Texture, opacity: number, fog: boolean) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: '#ffffff',
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog,
  });
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
    return { update(_time?: number, _camera?: THREE.Vector3, _state?: SimState) {}, dispose() {} };
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
  const lowClouds = makeCloudLayer(48, lowTexture, .52, true);
  const highClouds = makeCloudLayer(30, highTexture, .30, true);
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
  const baselineDensity = ambientFog.density;
  const windLength = Math.max(.1, Math.hypot(wind.x, wind.z));
  return {
    update(time: number, camera?: THREE.Vector3, state?: SimState) {
      if (camera) sky.position.copy(camera);
      const timeOfDay = evaluateTimeOfDay(mission, time);
      const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
      uniforms.zenith.value.copy(colorFromRgb(timeOfDay.skyZenith));
      uniforms.horizon.value.copy(colorFromRgb(timeOfDay.skyHorizon));
      uniforms.sunDirection.value.set(...timeOfDay.sunDirection);
      uniforms.sunColor.value.copy(colorFromRgb(timeOfDay.sunColor));
      uniforms.sunVisibility.value = THREE.MathUtils.smoothstep(timeOfDay.sunDirection[1], -.025, .03);
      const nightTint = colorFromRgb(timeOfDay.ambientColor);
      lowCloudMaterial.color.setRGB(1, 1, 1).lerp(nightTint, timeOfDay.nightStrength * .56);
      highCloudMaterial.color.setRGB(1, 1, 1).lerp(nightTint, timeOfDay.nightStrength * .46);
      lowCloudMaterial.opacity = .52 - timeOfDay.nightStrength * .18;
      highCloudMaterial.opacity = .30 - timeOfDay.nightStrength * .11;
      const baseFogColor = colorFromRgb(timeOfDay.fogColor);
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
  };
}
