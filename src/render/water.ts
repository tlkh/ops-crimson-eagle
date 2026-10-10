import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { Campaign, Mission, SimState } from '../types';
import { evaluateTimeOfDay } from './timeOfDay';
import { lakeShapeProfile } from '../sim/lakeShape';

export type WaterQuality = {
  reflectionSize: 256 | 512;
  reflectionIntervalMs: number;
  reflections: boolean;
};

// One small planar reflection is refreshed at a time. Its capture cadence and
// size follow the active quality profile; the mean surface remains the contact plane.
const vertexShader = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 mirrorUv;
  varying vec3 waterPosition;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    waterPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    mirrorUv = textureMatrix * vec4(position, 1.0);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec3 color;
  uniform float time;
  uniform float kind;
  uniform float reflectionReady;
  uniform vec3 daylightSun;
  uniform vec3 daylightSunColor;
  uniform vec3 daylightZenith;
  uniform vec3 daylightHorizon;
  uniform float daylightStrength;
  uniform float daylightAmbient;
  uniform vec2 wind;
  uniform vec4 ship;
  uniform float shipLength;
  uniform vec3 lake;
  uniform float lakeShapeBase;
  uniform vec4 lakeShapeHarmonicsA;
  uniform vec4 lakeShapeHarmonicsB;
  uniform vec4 coast;
  uniform float coastStart;
  uniform vec3 washA;
  uniform vec3 washB;
  uniform vec3 bucketRipple;
  varying vec4 mirrorUv;
  varying vec3 waterPosition;
  #include <common>
  #include <fog_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);
  }
  vec3 noiseGradient(vec2 p) {
    vec2 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f), du=6.0*f*(1.0-f);
    float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+1.0);
    float k=a-b-c+d;
    return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,
      (b-a+k*u.y)*du.x, (c-a+k*u.x)*du.y);
  }
  vec2 wave(vec2 p, vec2 d, float k, float speed, float slope) {
    vec3 swell = noiseGradient(p*.075+d*11.0);
    float phase = dot(p,d)*k-time*speed + swell.x*5.0;
    // Analytically fade waves smaller than a pixel, preventing horizon moire.
    float footprint = length(vec2(dFdx(phase),dFdy(phase)));
    return (d+swell.yz*.375/k) * cos(phase) * slope * exp(-footprint*footprint*.5);
  }
  float wash(vec2 p, vec3 source, out vec2 slope) {
    vec2 d = p-source.xy; float radius = length(d);
    float ring = exp(-pow((radius-10.5)/6.5,2.0));
    float outer = exp(-pow((radius-18.0)/15.0,2.0));
    float ripple = sin(radius*2.2-time*13.0 + noise(p*.35)*1.6);
    slope = d/max(radius,.1) * ripple * outer * source.z * .22;
    return ring * source.z * (.35+.65*noise(p*1.5-time*.9));
  }
  float lakeRadiusFactor(float angle) {
    vec4 first = vec4(cos(angle),sin(angle),cos(2.0*angle),sin(2.0*angle));
    vec4 second = vec4(cos(3.0*angle),sin(3.0*angle),cos(4.0*angle),sin(4.0*angle));
    return max(1.0,lakeShapeBase+dot(lakeShapeHarmonicsA,first)+dot(lakeShapeHarmonicsB,second));
  }
  void main() {
    vec2 p = waterPosition.xz;
    vec3 toEye = cameraPosition-waterPosition;
    float distanceToEye = length(toEye);
    vec3 view = normalize(toEye);
    float sea = 1.0-step(.5,kind);
    vec2 direction = normalize(wind+vec2(.001));
    vec2 crosswind = vec2(-direction.y,direction.x);
    float strength = mix(.42,1.0,sea);
    float fine = 1.0-smoothstep(80.0,700.0,distanceToEye);
    // Slowly changing flow bends the otherwise parallel wave trains into broad
    // patches. The lake uses a tighter, quieter warp than open sea.
    vec2 domainUv = p*.0035 + direction*time*.009;
    vec2 domain = vec2(
      noise(domainUv+vec2(2.7,6.1)),
      noise(domainUv+vec2(8.3,1.9))
    )-.5;
    float warpScale = mix(3.5,11.0,sea);
    vec2 wavePosition = p + domain*warpScale;
    vec2 flowDirection = normalize(direction + domain*mix(.14,.30,sea));
    vec2 flowCrosswind = vec2(-flowDirection.y,flowDirection.x);
    vec2 slope = wave(wavePosition,flowDirection,.075,.34,.075)*strength;
    slope += wave(wavePosition+domain*4.0,normalize(flowDirection+flowCrosswind*.46),.20,.64,.075)*strength;
    slope += wave(wavePosition-domain*3.0,normalize(flowDirection-flowCrosswind*.72),.54,1.08,.059)*strength;
    slope += wave(wavePosition,flowCrosswind,1.55,1.55,.039)*fine;
    slope += wave(wavePosition+domain,normalize(flowDirection+flowCrosswind*.32),3.9,2.2,.027)*fine;
    slope += wave(wavePosition+domain*1.7,normalize(flowDirection-flowCrosswind*.21),8.0,3.0,.013)*fine;
    float grain = noise(p*.37-direction*time*.24);
    slope *= .72+grain*.52;

    vec2 washSlopeA, washSlopeB;
    float aeration = wash(p,washA,washSlopeA)+wash(p,washB,washSlopeB);
    slope += washSlopeA+washSlopeB;
    float bucketDistance = length(p-bucketRipple.xy);
    float bucketWave = sin(bucketDistance*3.15-time*8.0+noise((p-bucketRipple.xy)*.13)*.5);
    slope += normalize(p-bucketRipple.xy+vec2(.01)) * bucketWave *
      exp(-bucketDistance*.18)*bucketRipple.z*.11;

    // Moored vessel: small reflected wave trains and foam at the waterline,
    // rather than a fast-moving wake behind a stationary gameplay platform.
    vec2 shipP = p-ship.xy;
    float bow = ship.w-shipLength;
    float width = ship.z * mix(.06,.42,smoothstep(bow,bow+shipLength*.19,shipP.y));
    float hullDistance = max(abs(shipP.x)-width,max(bow-shipP.y,shipP.y-ship.w));
    float outsideHull = step(0.0,hullDistance);
    float hullBand = exp(-max(hullDistance,0.0)*.18)*outsideHull*sea;
    slope += vec2(sign(shipP.x),.2)*sin(hullDistance*1.5-time*2.1+shipP.y*.12)*hullBand*.09;
    float foam = exp(-pow((hullDistance-.35)/.75,2.0))*outsideHull*sea*(.06+noise(p*.85-direction*time*.3)*.25);
    foam += pow(max(0.0,sin(hullDistance*1.4-time*1.7+shipP.y*.12)),12.0)*hullBand*.085;

    // Pale shallow margins follow the same irregular outline as the lake mesh.
    vec2 lp = p-lake.xy;
    float angle = atan(-lp.y,lp.x);
    float lakeRadius = lake.z*lakeRadiusFactor(angle);
    float lakeEdge = lakeRadius-length(lp);
    float margin = exp(-max(0.0,lakeEdge)*.13)*step(.5,kind)*(1.0-step(1.5,kind));
    float along = dot(p-coast.xy,coast.zw);
    float across = dot(p-coast.xy,vec2(-coast.w,coast.z));
    float beachDistance = coastStart+34.0*sin(across*.003)+19.0*sin(across*.008+.5)-along;
    foam += exp(-pow((beachDistance-2.5-sin(time*.8+across*.027)*1.8)/2.5,2.0))*sea*.26;
    foam += margin*(.10+.12*sin(time*1.5+angle*41.0));

    vec3 normal = normalize(vec3(-slope.x,1.0,-slope.y));
    float facing = max(.0,dot(view,normal));
    float fresnel = .07+.70*pow(1.0-facing,4.0);
    vec3 reflectedDirection = reflect(-view,normal);
    vec3 sky = mix(daylightHorizon,daylightZenith,pow(max(0.0,reflectedDirection.y),.5));
    vec2 projected = mirrorUv.xy/max(mirrorUv.w,.001);
    vec2 distortion = slope * .014 * (1.0-smoothstep(500.0,3500.0,distanceToEye));
    vec2 reflectionUv = clamp(projected+distortion,vec2(.002),vec2(.998));
    float validUv = step(.001,projected.x)*step(projected.x,.999)*step(.001,projected.y)*step(projected.y,.999);
    vec3 reflection = mix(sky,texture2D(tDiffuse,reflectionUv).rgb,reflectionReady*validUv);
    vec3 base = color*(.83+grain*.26);
    base = mix(base,vec3(.12,.23,.19),margin*.5);
    float shallow = sea * (1.0-smoothstep(0.0,100.0,max(0.0,beachDistance)));
    vec3 sediment = mix(vec3(.18,.19,.12), vec3(.28,.27,.18),noise(p*.085));
    base = mix(base,sediment,shallow*.56) * daylightAmbient;
    vec3 result = mix(base,reflection,fresnel);
    vec3 sun = daylightSun;
    vec3 halfVector = normalize(sun+view);
    float glint = pow(max(0.0,dot(normal,halfVector)),180.0);
    result += daylightSunColor*glint*.75*daylightStrength;
    result = mix(result,vec3(.60,.70,.68)*daylightAmbient,clamp(foam+aeration*.24,0.0,.66));
    float impactFoam = exp(-pow((bucketDistance-(3.0+fract(time*.28)*1.6))/.68,2.0))*bucketRipple.z;
    result += vec3(.08,.11,.105)*daylightAmbient*bucketRipple.z*exp(-pow((bucketDistance-2.0)/1.4,2.0));
    result = mix(result,vec3(.69,.77,.72)*daylightAmbient,impactFoam*.2);
    float shoreTransparency = sea * (1.0-smoothstep(0.0,72.0,max(0.0,beachDistance)));
    gl_FragColor = vec4(result,1.0-shoreTransparency*.28);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createWater(scene: THREE.Scene, campaign: Campaign, mission: Mission, options: { reflections?: boolean; reflectionSize?: 256 | 512; reflectionIntervalMs?: number } = {}) {
  let quality: WaterQuality = {
    reflectionSize: options.reflectionSize ?? 512,
    reflectionIntervalMs: options.reflectionIntervalMs ?? 80,
    reflections: options.reflections ?? true,
  };
  const jp = campaign.id === 'jp_ketapang_2026_09';
  const lakeShape = lakeShapeProfile(campaign.id);
  const target = mission.shore ?? mission.lake;
  const route = new THREE.Vector2(target.x-mission.ship.x,target.z-mission.ship.z);
  const routeLength = route.length(); route.normalize();
  const shared = {
    daylightSun: { value: new THREE.Vector3() }, daylightSunColor: { value: new THREE.Color() },
    daylightZenith: { value: new THREE.Color() }, daylightHorizon: { value: new THREE.Color() },
    daylightStrength: { value: 1 }, daylightAmbient: { value: 1 },
    time: { value: 0 }, wind: { value: new THREE.Vector2(mission.wind.x,mission.wind.z) },
    ship: { value: new THREE.Vector4(mission.ship.x,mission.ship.z,campaign.shipWidth,jp?40:35) },
    shipLength: { value: campaign.shipLength },
    lake: { value: new THREE.Vector3(mission.lake.x,mission.lake.z,mission.lake.radius) },
    lakeShapeBase: { value: lakeShape.base },
    lakeShapeHarmonicsA: { value: new THREE.Vector4(...lakeShape.harmonics[0], ...lakeShape.harmonics[1]) },
    lakeShapeHarmonicsB: { value: new THREE.Vector4(...lakeShape.harmonics[2], ...lakeShape.harmonics[3]) },
    coast: { value: new THREE.Vector4(mission.ship.x,mission.ship.z,route.x,route.y) },
    coastStart: { value: routeLength*.42 },
    washA: { value: new THREE.Vector3() }, washB: { value: new THREE.Vector3() },
    bucketRipple: { value: new THREE.Vector3() },
  };
  const surfaces: Array<{ mesh: Reflector; kind: number; captured: boolean; lastCapture: number }> = [];
  let reflecting = false;
  let activeKind = 0;
  const waterColor = (kind: number) => new THREE.Color(kind===0?'#356d73':jp?'#3f6157':'#396c65');
  const shader = (kind: number) => ({
    name: 'Crimson reflective water', vertexShader, fragmentShader,
    uniforms: {
      ...THREE.UniformsLib.fog, ...shared,
      color: { value: waterColor(kind) }, tDiffuse: { value: null },
      textureMatrix: { value: new THREE.Matrix4() },
      kind: { value: kind }, reflectionReady: { value: 0 },
    },
  });
  function surface(geometry: THREE.BufferGeometry, kind: 0 | 1, position: THREE.Vector3) {
    const mesh = new Reflector(geometry, { textureWidth: quality.reflectionSize, textureHeight: quality.reflectionSize, multisample: 0, color: waterColor(kind), shader: shader(kind), clipBias: .002 });
    mesh.name = kind===0?'Reflective sea':'Reflective freshwater';
    mesh.rotation.x = -Math.PI/2; mesh.position.copy(position);
    const material = mesh.material as THREE.ShaderMaterial;
    material.fog = true;
    material.transparent = kind === 0;
    // Reflector clones uniforms; reconnect only the animated environmental values.
    Object.assign(material.uniforms,shared);
    const reflectionPass = mesh.onBeforeRender;
    const entry = {mesh,kind,captured:false,lastCapture:-Infinity};
    surfaces.push(entry);
    mesh.onBeforeRender = function(renderer,renderScene,camera,geometry,material,group) {
      if (!quality.reflections || reflecting || entry.kind!==activeKind) return;
      const now = performance.now();
      if (entry.captured && now-entry.lastCapture<quality.reflectionIntervalMs) return;
      reflecting = true;
      const hidden = surfaces.filter(other=>other!==entry && other.mesh.visible);
      hidden.forEach(other=>other.mesh.visible=false);
      try {
        reflectionPass.call(this,renderer,renderScene,camera,geometry,material,group);
        entry.captured=true; entry.lastCapture=now;
        (mesh.material as THREE.ShaderMaterial).uniforms.reflectionReady.value=1;
      } finally {
        hidden.forEach(other=>other.mesh.visible=true);
        reflecting=false;
      }
    };
    scene.add(mesh);
    return mesh;
  }
  // Rivers share the surface lighting, without another full scene reflection.
  const riverMaterial = new THREE.ShaderMaterial({...shader(2),fog:true});
  Object.assign(riverMaterial.uniforms,shared);
  return {
    surface, riverMaterial,
    setQuality(next: WaterQuality) {
      const wasEnabled = quality.reflections;
      const previousSize = quality.reflectionSize;
      quality = {
        reflectionSize: next.reflectionSize,
        reflectionIntervalMs: Number.isFinite(next.reflectionIntervalMs) ? Math.max(0, next.reflectionIntervalMs) : 80,
        reflections: next.reflections,
      };
      for (const entry of surfaces) {
        if (previousSize !== quality.reflectionSize) entry.mesh.getRenderTarget().setSize(quality.reflectionSize, quality.reflectionSize);
        if (previousSize !== quality.reflectionSize || wasEnabled !== quality.reflections) {
          entry.captured = false;
          (entry.mesh.material as THREE.ShaderMaterial).uniforms.reflectionReady.value = 0;
        }
      }
    },
    update(time: number, state?: SimState) {
      shared.time.value=time;
      const daylight = evaluateTimeOfDay(mission, time);
      shared.daylightSun.value.set(...daylight.sunDirection);
      shared.daylightSunColor.value.setRGB(...daylight.sunColor);
      shared.daylightZenith.value.setRGB(...daylight.skyZenith);
      shared.daylightHorizon.value.setRGB(...daylight.skyHorizon);
      shared.daylightStrength.value = daylight.sunIntensity / 3.5;
      shared.daylightAmbient.value = 1 - daylight.nightStrength * .92;
      if (!state) return;
      const p=state.position;
      const overLake=Math.hypot(p.x-mission.lake.x,p.z-mission.lake.z)<mission.lake.radius+100;
      activeKind=overLake?1:0;
      const height=overLake?.025:-9;
      const overSea=(p.x-mission.ship.x)*route.x+(p.z-mission.ship.z)*route.y<routeLength*.42;
      const aboveDeck=Math.abs(p.x-mission.ship.x)<campaign.shipWidth*.6 && p.z-mission.ship.z>(jp?40:35)-campaign.shipLength && p.z-mission.ship.z<(jp?40:35);
      const strength=(overLake||overSea)&&!aboveDeck&&state.phase!=='failed'
        ? THREE.MathUtils.clamp(1-(p.y-height)/65,0,1)**1.5 : 0;
      const sin=Math.sin(state.heading), cos=Math.cos(state.heading);
      shared.washA.value.set(p.x-sin*5.7,p.z-cos*5.7,strength);
      shared.washB.value.set(p.x+sin*6.15,p.z+cos*6.15,strength);
      const bucketWet=state.bucketAttached&&overLake ? THREE.MathUtils.clamp(1-Math.abs(state.bucket.y-.025)/3,0,1):0;
      shared.bucketRipple.value.set(state.bucket.x,state.bucket.z,bucketWet);
    },
    dispose() { surfaces.forEach(({mesh})=>mesh.dispose()); riverMaterial.dispose(); },
  };
}
