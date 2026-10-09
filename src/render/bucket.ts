import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import type { ExtendedSimState, WaterPacket } from '../sim/types';
import { BUCKET_BODY_HEIGHT_M, BUCKET_LIFT_OFFSET_M, SLING_LENGTH_M,
  bucketMinimumRimHeight, bucketSurfaceHeight, getBucketHook } from '../sim/bucket';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const cableSegments = 40;
const cableSides = 7;

function mistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(224,240,233,.75)');
  gradient.addColorStop(.38, 'rgba(217,236,230,.34)');
  gradient.addColorStop(1, 'rgba(217,236,230,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** A rim-centered bucket, short webbing bridle and one flexible suspension line. */
export function createBucketRig(scene: THREE.Scene) {
  const root = new THREE.Group(); root.name = 'Bucket and suspended water'; scene.add(root);
  const bucket = new THREE.Group(); bucket.name = 'Firefighting bucket'; root.add(bucket);
  const fabric = new THREE.MeshStandardMaterial({ color: '#b48a54', roughness: .94, side: THREE.DoubleSide });
  const webbing = new THREE.MeshStandardMaterial({ color: '#343e34', roughness: .95 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: '#c9bb91', roughness: .7 });
  const metal = new THREE.MeshStandardMaterial({ color: '#666e66', roughness: .42, metalness: .55 });
  function part(geometry: THREE.BufferGeometry, material: THREE.Material, y = 0) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.y = y;
    mesh.castShadow = true; mesh.receiveShadow = true; bucket.add(mesh); return mesh;
  }
  // A broad fabric bag sized for the five-tonne game load. Its bottom is closed.
  part(new THREE.CylinderGeometry(1.18, .90, BUCKET_BODY_HEIGHT_M, 32, 3, true), fabric, -BUCKET_BODY_HEIGHT_M / 2);
  part(new THREE.CylinderGeometry(.90, .82, .12, 24), webbing, -BUCKET_BODY_HEIGHT_M + .06);
  for (const [height, radius] of [[0, 1.18], [-1.29, .925]]) {
    const rim = part(new THREE.TorusGeometry(radius, .045, 7, 32), rimMaterial, height);
    rim.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * TAU;
    const strap = part(new THREE.BoxGeometry(.07, 1.44, .024), webbing, -.72);
    strap.position.x = Math.sin(angle) * 1.05; strap.position.z = Math.cos(angle) * 1.05;
    strap.rotation.set(0, angle, 0); strap.rotateX(.19);
  }
  // These three short, flexible straps converge at an eye; there are no upright rods.
  for (let i = 0; i < 3; i++) {
    const angle = i / 3 * TAU;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(Math.sin(angle) * 1.16, 0, Math.cos(angle) * 1.16),
      new THREE.Vector3(Math.sin(angle) * .62, .25, Math.cos(angle) * .62),
      new THREE.Vector3(0, BUCKET_LIFT_OFFSET_M, 0),
    );
    part(new THREE.TubeGeometry(curve, 8, .025, 5, false), webbing);
  }
  const eye = part(new THREE.TorusGeometry(.09, .027, 6, 12), metal, BUCKET_LIFT_OFFSET_M);
  eye.rotation.y = Math.PI / 2;
  const outlet = part(new THREE.CylinderGeometry(.24, .2, .12, 16), metal, -BUCKET_BODY_HEIGHT_M + .04);
  outlet.name = 'Bucket release valve';
  const waterMaterial = new THREE.MeshStandardMaterial({ color: '#709d99', roughness: .18, metalness: .15, transparent: true, opacity: .86 });
  const water = part(new THREE.CircleGeometry(1.12, 32), waterMaterial, -.1); water.rotation.x = -Math.PI / 2;
  water.castShadow = false;

  const cableGeometry = new THREE.BufferGeometry();
  const vertices = new Float32Array((cableSegments + 1) * cableSides * 3);
  const normals = new Float32Array(vertices.length);
  const indices: number[] = [];
  for (let j = 0; j < cableSegments; j++) for (let i = 0; i < cableSides; i++) {
    const a = j * cableSides + i, b = j * cableSides + (i + 1) % cableSides;
    indices.push(a, b, a + cableSides, b, b + cableSides, a + cableSides);
  }
  cableGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
  cableGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  cableGeometry.setIndex(indices);
  const cable = new THREE.Mesh(cableGeometry, new THREE.MeshStandardMaterial({ color: '#a9a895', roughness: .88 }));
  cable.name = 'Flexible single sling cable'; cable.frustumCulled = false; root.add(cable);
  const points = Array.from({ length: cableSegments + 1 }, () => new THREE.Vector3());
  const hook = new THREE.Vector3(), eyeWorld = new THREE.Vector3(), direction = new THREE.Vector3();
  const tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3();
  const tilt = new THREE.Quaternion(), identity = new THREE.Quaternion();

  // Pooled droplets follow the simulation packets; no second, independent water trajectory.
  const droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5),
    new THREE.MeshPhongMaterial({ color: '#e0f0e9', emissive: '#304440', specular: '#effffb', shininess: 110, transparent: true, opacity: .72, depthWrite: false }), 640);
  droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage); droplets.frustumCulled = false;
  droplets.renderOrder = 2;
  droplets.name = 'Falling bucket water'; droplets.count = 0; root.add(droplets);
  const dropTransform = new THREE.Object3D();
  const texture = mistTexture();
  const spray = Array.from({ length: 18 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false; root.add(sprite); return sprite;
  });
  const impacts = Array.from({ length: 16 }, () => {
    const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(.7, 1, 32), new THREE.MeshBasicMaterial({ color: '#dce8df', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; mist.visible = ring.visible = false; root.add(mist, ring);
    return { mist, ring, born: -100, x: 0, y: 0, z: 0 };
  });
  type VisiblePacket = { id: number; born: number; x: number; y: number; z: number };
  const packets = new Map<WaterPacket, VisiblePacket>();
  let packetId = 0, impactId = 0, previousTime = -1;
  const random = (n: number) => { const x = Math.sin(n * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };

  function drawDrop(x: number, y: number, z: number, width: number, length: number, index: number) {
    if (index >= droplets.instanceMatrix.count) return index;
    dropTransform.position.set(x, y, z); dropTransform.scale.set(width, length, width);
    dropTransform.updateMatrix(); droplets.setMatrixAt(index, dropTransform.matrix); return index + 1;
  }

  return {
    update(state: SimState, campaign: Campaign, mission: Mission) {
      const sim = state as ExtendedSimState, time = state.timeSec;
      if (time < previousTime) {
        packets.clear(); impacts.forEach(impact => impact.born = -100);
      }
      previousTime = time;
      bucket.visible = true;
      const groundRim = bucketMinimumRimHeight(campaign, mission, state.bucket.x, state.bucket.z);
      bucket.position.set(state.bucket.x, Math.max(state.bucket.y, groundRim), state.bucket.z);
      const hookPosition = getBucketHook(state); hook.set(hookPosition.x, hookPosition.y, hookPosition.z);
      direction.copy(hook).sub(bucket.position).normalize();
      tilt.setFromUnitVectors(UP, direction.y > .05 ? direction : UP);
      bucket.quaternion.copy(identity).slerp(tilt, state.bucketAttached ? clamp((state.bucket.y - groundRim) / 3, 0, .28) : 0);
      const load = clamp(state.waterLitres / 5000, 0, 1);
      water.visible = load > .005;
      water.position.y = -BUCKET_BODY_HEIGHT_M + .12 + load * (BUCKET_BODY_HEIGHT_M - .22);
      water.scale.setScalar(.81 + load * .19);
      eyeWorld.set(0, BUCKET_LIFT_OFFSET_M, 0); bucket.localToWorld(eyeWorld);
      cable.visible = state.bucketAttached;
      if (cable.visible) {
        const distance = hook.distanceTo(eyeWorld);
        const slack = Math.max(0, SLING_LENGTH_M - distance);
        const sag = Math.min(6, Math.sqrt(Math.max(0, SLING_LENGTH_M ** 2 - distance ** 2)) * .32);
        const sideways = Math.min(5.5, slack * .4);
        for (let j = 0; j <= cableSegments; j++) {
          const t = j / cableSegments, arch = Math.sin(Math.PI * t);
          const p = points[j].lerpVectors(hook, eyeWorld, t);
          // A slack rope drapes to the surface with a gentle coil to the side.
          p.x += Math.cos(state.heading) * sideways * arch * Math.sin(TAU * t);
          p.z -= Math.sin(state.heading) * sideways * arch * Math.sin(TAU * t);
          p.y -= sag * arch;
          if (slack > .1) p.y = Math.max(p.y, bucketSurfaceHeight(campaign, mission, p.x, p.z) + .06);
        }
        for (let j = 0; j <= cableSegments; j++) {
          tangent.subVectors(points[Math.min(cableSegments, j + 1)], points[Math.max(0, j - 1)]).normalize();
          normal.crossVectors(tangent, Math.abs(tangent.y) > .9 ? RIGHT : UP).normalize();
          binormal.crossVectors(tangent, normal).normalize();
          for (let i = 0; i < cableSides; i++) {
            const a = i / cableSides * TAU, c = Math.cos(a), s = Math.sin(a), k = (j * cableSides + i) * 3;
            for (let axis = 0; axis < 3; axis++) {
              const n = normal.getComponent(axis) * c + binormal.getComponent(axis) * s;
              normals[k + axis] = n; vertices[k + axis] = points[j].getComponent(axis) + n * .065;
            }
          }
        }
        cableGeometry.attributes.position.needsUpdate = true;
        cableGeometry.attributes.normal.needsUpdate = true;
      }
      const alive = new Set(sim.waterPackets ?? []);
      for (const [packet, visual] of packets) if (!alive.has(packet)) {
        const impact = impacts[impactId++ % impacts.length];
        Object.assign(impact, { born: time, x: visual.x, y: bucketSurfaceHeight(campaign, mission, visual.x, visual.z), z: visual.z });
        packets.delete(packet);
      }
      let count = 0;
      for (const packet of alive) {
        let visual = packets.get(packet);
        if (!visual) { visual = { id: packetId++, born: time, x: 0, y: 0, z: 0 }; packets.set(packet, visual); }
        const p = packet.position; Object.assign(visual, p);
        const age = Math.max(0, time - visual.born), spread = .12 + Math.min(age, 3) * .48;
        const floor = bucketSurfaceHeight(campaign, mission, p.x, p.z);
        for (let j = 0; j < 16; j++) {
          const seed = visual.id * 37 + j * 11, angle = random(seed) * TAU;
          const radius = Math.sqrt(random(seed + 1)) * spread;
          const y = p.y + (random(seed + 2) - .5) * (.7 + Math.abs(packet.velocity.y) * .08);
          if (y > floor + .1) count = drawDrop(p.x + Math.cos(angle) * radius, y, p.z + Math.sin(angle) * radius,
            .08 + random(seed + 3) * .12, .24 + Math.min(age, 1) * .16, count);
        }
      }
      // A short, dense outlet stream joins the first ballistic packets to the valve.
      if (sim.dumping && state.waterLitres > 0) {
        for (let i = 0; i < 12; i++) {
          const t = (i / 12 + time * 2) % 1, fall = t * 1.8;
          const y = state.bucket.y - BUCKET_BODY_HEIGHT_M - fall;
          if (y > bucketSurfaceHeight(campaign, mission, state.bucket.x, state.bucket.z)) {
            count = drawDrop(state.bucket.x + Math.sin(i * 3.1 + time * 13) * .07, y,
              state.bucket.z + Math.cos(i * 1.7 + time * 15) * .07, .17 + t * .12, .22, count);
          }
        }
      }
      droplets.count = count; droplets.instanceMatrix.needsUpdate = true;
      const waterPackets = [...packets.entries()];
      spray.forEach((sprite, i) => {
        const entry = waterPackets[i * 2]; sprite.visible = !!entry;
        if (!entry) return;
        const [packet, visual] = entry, age = Math.max(0, time - visual.born);
        sprite.position.set(packet.position.x + Math.sin(i * 2.4) * age * .3, packet.position.y, packet.position.z);
        sprite.scale.setScalar(.7 + age * 1.1); sprite.material.opacity = Math.min(.26, age * .2);
      });
      impacts.forEach(impact => {
        const age = time - impact.born, visible = age >= 0 && age < 1.3;
        impact.mist.visible = impact.ring.visible = visible;
        if (!visible) return;
        impact.mist.position.set(impact.x + mission.wind.x * age * .12, impact.y + .6 + age * 1.5, impact.z + mission.wind.z * age * .12);
        impact.mist.scale.set(3 + age * 5, 1.4 + age * 2, 1);
        impact.mist.material.opacity = .32 * (1 - age / 1.3);
        impact.ring.position.set(impact.x, impact.y + .035, impact.z);
        impact.ring.scale.setScalar(.4 + age * 3);
        impact.ring.material.opacity = .22 * (1 - age / 1.3);
      });
    },
  };
}
