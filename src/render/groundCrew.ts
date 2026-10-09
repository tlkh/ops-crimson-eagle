import * as THREE from 'three';
import type { Campaign, Mission, SimState } from '../types';
import { bucketSurfaceHeight } from '../sim/bucket';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

type InstancePart = { mesh: THREE.InstancedMesh };

/** A small, simulation-clocked ground party for the two bucket handling sites. */
export function createGroundCrew(scene: THREE.Scene, campaign: Campaign, mission: Mission): { update(state: SimState): void } {
  const root = new THREE.Group();
  root.name = 'Bucket ground handling crew';
  scene.add(root);

  const japanese = campaign.id === 'jp_ketapang_2026_09';
  const site = japanese ? (mission.shore ?? mission.lake) : mission.ship;
  const siteX = site.x, siteZ = site.z;
  const floorAt = (x: number, z: number) => bucketSurfaceHeight(campaign, mission, x, z);

  const coveralls = new THREE.MeshStandardMaterial({ color: '#263944', roughness: .88 });
  const vest = new THREE.MeshStandardMaterial({ color: '#e7d34a', emissive: '#473b08', roughness: .72 });
  const tape = new THREE.MeshStandardMaterial({ color: '#e4e5d2', emissive: '#25261e', roughness: .48, metalness: .08 });
  const helmet = new THREE.MeshStandardMaterial({ color: '#e79c32', roughness: .58 });
  const skin = new THREE.MeshStandardMaterial({ color: '#a96e4f', roughness: .93 });
  const boot = new THREE.MeshStandardMaterial({ color: '#20292b', roughness: .84 });
  const headset = new THREE.MeshStandardMaterial({ color: '#202527', roughness: .7 });
  const radioMat = new THREE.MeshStandardMaterial({ color: '#384448', roughness: .77 });
  const toolboxMat = new THREE.MeshStandardMaterial({ color: '#ad5033', roughness: .8 });
  const steel = new THREE.MeshStandardMaterial({ color: '#4b5555', roughness: .58, metalness: .55 });
  const reelWood = new THREE.MeshStandardMaterial({ color: '#9a7040', roughness: .86 });
  const coneMat = new THREE.MeshStandardMaterial({ color: '#ed7733', roughness: .78 });
  const coneStripe = new THREE.MeshStandardMaterial({ color: '#ece7d2', roughness: .65 });

  const parts: InstancePart[] = [];
  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.count = count;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);
    parts.push({ mesh });
    return mesh;
  };

  // Repeated pieces are instanced by material and shape so the crew stays legible
  // without adding a draw call for every joint and reflective strip.
  const torsoMesh = instanced(new THREE.BoxGeometry(1, 1, 1), coveralls, 3, 'Coverall torsos');
  const vestMesh = instanced(new THREE.BoxGeometry(1, 1, 1), vest, 3, 'High visibility vests');
  const tapeMesh = instanced(new THREE.BoxGeometry(1, 1, 1), tape, 6, 'Reflective vest bands');
  const pelvisMesh = instanced(new THREE.BoxGeometry(1, 1, 1), coveralls, 3, 'Coverall waists');
  const upperArmMesh = instanced(new THREE.CylinderGeometry(1, .92, 1, 8), coveralls, 6, 'Upper arms');
  const lowerArmMesh = instanced(new THREE.CylinderGeometry(.9, .78, 1, 8), coveralls, 6, 'Forearms');
  const handMesh = instanced(new THREE.SphereGeometry(1, 8, 6), boot, 6, 'Gloved hands');
  const upperLegMesh = instanced(new THREE.CylinderGeometry(1, .92, 1, 8), coveralls, 6, 'Upper legs');
  const lowerLegMesh = instanced(new THREE.CylinderGeometry(.88, .72, 1, 8), coveralls, 6, 'Lower legs');
  const kneeMesh = instanced(new THREE.BoxGeometry(1, 1, 1), boot, 6, 'Knee pads');
  const bootMesh = instanced(new THREE.BoxGeometry(1, 1, 1), boot, 6, 'Safety boots');
  const neckMesh = instanced(new THREE.CylinderGeometry(1, 1, 1, 8), skin, 3, 'Necks');
  const headMesh = instanced(new THREE.SphereGeometry(1, 10, 8), skin, 3, 'Faces');
  const faceMesh = instanced(new THREE.SphereGeometry(1, 10, 8), skin, 3, 'Face profiles');
  const helmetDomeMesh = instanced(new THREE.SphereGeometry(1, 10, 7), helmet, 3, 'Safety helmets');
  const helmetRimMesh = instanced(new THREE.CylinderGeometry(1, 1, 1, 12), helmet, 3, 'Helmet brims');
  const earMesh = instanced(new THREE.SphereGeometry(1, 8, 6), headset, 6, 'Headset ear cups');
  const micMesh = instanced(new THREE.CylinderGeometry(1, 1, 1, 6), headset, 3, 'Headset microphones');
  const radioMesh = instanced(new THREE.BoxGeometry(1, 1, 1), radioMat, 3, 'Belt radios');
  const clipboardMesh = instanced(new THREE.BoxGeometry(1, 1, 1), tape, 1, 'Handling checklist');

  const dummy = new THREE.Object3D();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const vDelta = new THREE.Vector3();
  const workers = [
    { standby: [8.05, -3.55] as const, work: [7.55, -.82] as const, role: 'rigger' },
    { standby: [8.05, 3.55] as const, work: [7.55, .82] as const, role: 'rigger' },
    { standby: [9.58, .15] as const, work: [9.48, .25] as const, role: 'signal' },
  ];

  const localToWorld = (x: number, y: number, z: number, px: number, pz: number, yaw: number) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return new THREE.Vector3(px + c * x + s * z, y, pz - s * x + c * z);
  };
  const bodyPoint = (x: number, y: number, z: number, floor: number, px: number, pz: number, yaw: number, lean: number, drop: number) => {
    // Rigging workers hinge forward at the waist while their feet stay planted.
    const by = y - .64;
    const yy = .64 + by * Math.cos(lean) - z * Math.sin(lean) - drop;
    const zz = by * Math.sin(lean) + z * Math.cos(lean);
    const p = localToWorld(x, yy, zz, px, pz, yaw);
    p.y += floor;
    return p;
  };
  const putBox = (mesh: THREE.InstancedMesh, index: number, point: THREE.Vector3, size: [number, number, number], yaw: number, pitch = 0) => {
    dummy.position.copy(point);
    dummy.rotation.set(pitch, yaw, 0, 'YXZ');
    dummy.scale.set(...size);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  };
  const putSphere = (mesh: THREE.InstancedMesh, index: number, point: THREE.Vector3, scale: [number, number, number], yaw = 0) => {
    dummy.position.copy(point); dummy.rotation.set(0, yaw, 0); dummy.scale.set(...scale);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  };
  const putSegment = (mesh: THREE.InstancedMesh, index: number, a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
    vDelta.subVectors(b, a);
    const length = Math.max(.01, vDelta.length());
    dummy.position.copy(a).add(b).multiplyScalar(.5);
    dummy.quaternion.setFromUnitVectors(yAxis, vDelta.normalize());
    dummy.scale.set(radius, length, radius);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  };
  const makeStaticInstances = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string, parent: THREE.Object3D) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name; mesh.count = count; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
    parent.add(mesh); return mesh;
  };
  const placeStaticInstance = (mesh: THREE.InstancedMesh, index: number, point: [number, number, number], scale: [number, number, number], rotation: [number, number, number] = [0, 0, 0]) => {
    dummy.position.set(...point); dummy.rotation.set(...rotation); dummy.scale.set(...scale);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  };

  const surfaceProp = (group: THREE.Group, x: number, z: number) => {
    group.position.set(x, floorAt(x, z), z);
    root.add(group);
    return group;
  };
  const box = (parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  // Compact reel trolley, kept at the marked handling station throughout flight.
  const cartX = siteX + 9.25, cartZ = siteZ - 5.6;
  const cart = surfaceProp(new THREE.Group(), cartX, cartZ);
  cart.name = 'Wheeled sling cable reel';
  const frameMesh = makeStaticInstances(new THREE.BoxGeometry(1, 1, 1), steel, 8, 'Reel trolley frame', cart);
  const framePieces: [number, number, number, number, number, number][] = [
    [1.16, .13, .88, 0, .62, 0],
    [.08, .52, .08, -.49, .89, -.31], [.08, .52, .08, .49, .89, -.31],
    [.08, .52, .08, -.49, .89, .31], [.08, .52, .08, .49, .89, .31],
    [.92, .07, .08, 0, 1.13, -.31], [.92, .07, .08, 0, 1.13, .31],
    [.74, .05, .06, 0, 1.36, -.46],
  ];
  framePieces.forEach(([sx, sy, sz, x, y, z], index) => placeStaticInstance(frameMesh, index, [x, y, z], [sx, sy, sz]));
  const wheelMesh = makeStaticInstances(new THREE.CylinderGeometry(1, 1, 1, 12), boot, 2, 'Reel trolley wheels', cart);
  for (const [index, side] of [-1, 1].entries()) placeStaticInstance(wheelMesh, index, [side * .58, .35, 0], [.34, .13, .34], [0, 0, Math.PI / 2]);
  const reel = new THREE.Group(); reel.name = 'Turning cable drum'; cart.add(reel);
  const woodenCylinder = makeStaticInstances(new THREE.CylinderGeometry(1, 1, 1, 16), reelWood, 3, 'Cable drum and flanges', reel);
  placeStaticInstance(woodenCylinder, 0, [0, 0, 0], [.29, .64, .29], [0, 0, Math.PI / 2]);
  placeStaticInstance(woodenCylinder, 1, [-.39, 0, 0], [.48, .055, .48], [0, 0, Math.PI / 2]);
  placeStaticInstance(woodenCylinder, 2, [.39, 0, 0], [.48, .055, .48], [0, 0, Math.PI / 2]);
  const coil = makeStaticInstances(new THREE.CylinderGeometry(.35, .35, .68, 20), boot, 1, 'Coiled sling cable', reel);
  placeStaticInstance(coil, 0, [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  const spokeMesh = makeStaticInstances(new THREE.BoxGeometry(1, 1, 1), reelWood, 8, 'Cable drum spokes', reel);
  for (let spoke = 0; spoke < 8; spoke++) {
    const angle = spoke / 8 * TAU;
    placeStaticInstance(spokeMesh, spoke, [0, Math.sin(angle) * .21, Math.cos(angle) * .21], [.052, .055, .38], [angle, 0, 0]);
  }
  const axleMesh = makeStaticInstances(new THREE.CylinderGeometry(1, 1, 1, 10), steel, 1, 'Cable drum axle', reel);
  placeStaticInstance(axleMesh, 0, [0, 0, 0], [.095, .78, .095], [0, 0, Math.PI / 2]);
  // The drum centre sits high enough to be seen in the chase view.
  reel.position.set(0, 1.21, 0);

  const toolbox = surfaceProp(new THREE.Group(), siteX + 9.3, siteZ + 5.0);
  toolbox.name = 'Ground crew toolbox';
  box(toolbox, [.88, .43, .56], [0, .24, 0], toolboxMat);
  const toolboxSteel = makeStaticInstances(new THREE.BoxGeometry(1, 1, 1), steel, 2, 'Toolbox lid and clasp', toolbox);
  placeStaticInstance(toolboxSteel, 0, [0, .49, 0], [.91, .07, .59]);
  placeStaticInstance(toolboxSteel, 1, [0, .24, .31], [.08, .13, .06]);
  box(toolbox, [.26, .045, .05], [0, .56, 0], boot);

  const conePlaces: [number, number][] = [[7.8, -5.5], [8.5, 5.5], [10.0, 2.9]];
  const coneBases = makeStaticInstances(new THREE.BoxGeometry(1, 1, 1), coneMat, 3, 'Safety cone bases', root);
  const coneBodies = makeStaticInstances(new THREE.ConeGeometry(.22, .55, 10), coneMat, 3, 'Safety cones', root);
  const coneBands = makeStaticInstances(new THREE.CylinderGeometry(.125, .145, .07, 10), coneStripe, 3, 'Safety cone reflective bands', root);
  conePlaces.forEach(([dx, dz], index) => {
    const x = siteX + dx, z = siteZ + dz, floor = floorAt(x, z);
    placeStaticInstance(coneBases, index, [x, floor + .0325, z], [.54, .065, .54]);
    placeStaticInstance(coneBodies, index, [x, floor + .34, z], [1, 1, 1]);
    placeStaticInstance(coneBands, index, [x, floor + .3, z], [1, 1, 1]);
  });

  let updated = false;
  let previousTime = 0;
  let previousRigProgress = 0;
  let previousRigMode = '';
  let reelTurns = 0;
  let previousWasRigging = false;

  function update(state: SimState): void {
    const time = Number.isFinite(state.timeSec) ? state.timeSec : 0;
    const rigPhase = state.phase === 'shore_rig' || state.phase === 'shore_unrig' || state.phase === 'deck_rig';
    const progress = clamp(Number.isFinite(state.rigProgress) ? state.rigProgress : 0, 0, 1);
    const detach = state.phase === 'shore_unrig' || (state.phase === 'deck_rig' && state.bucketAttached);
    const mode = detach ? 'wind' : 'pay';

    if (!updated || time < previousTime) {
      reelTurns = rigPhase && progress > 0 ? (detach ? -1 : 1) * progress * 3 : 0;
      previousWasRigging = rigPhase && progress > 0;
      previousRigProgress = progress;
      previousRigMode = mode;
    } else if (rigPhase && progress > 0) {
      if (!previousWasRigging || previousRigMode !== mode) reelTurns = 0;
      else reelTurns += (detach ? -1 : 1) * (progress - previousRigProgress) * 3;
      previousWasRigging = true;
    } else if (previousWasRigging) {
      // The crew already retreats during the final fifth of the operation.
      previousWasRigging = false;
    }
    previousTime = time;
    previousRigProgress = progress;
    previousRigMode = mode;
    updated = true;

    const dx = state.position.x - siteX, dz = state.position.z - siteZ;
    const aircraftDistance = Math.hypot(dx, dz);
    const rigNear = rigPhase && aircraftDistance < 25 && state.position.y < 6;
    const approach = rigNear ? smooth(0, .2, progress) : 0;
    const retreat = rigNear ? smooth(.78, .98, progress) : 0;
    const workAmount = Math.max(0, approach * (1 - retreat));
    const walking = rigNear && progress > 0 && progress < .98
      ? Math.max(1 - smooth(0, .2, progress), retreat) : 0;

    cart.visible = toolbox.visible = true;
    // Axle sway is deliberately tiny: the trolley remains planted while the
    // aircraft and bucket move independently through the simulation.
    cart.rotation.y = 0;
    cart.position.x = cartX;
    cart.position.z = cartZ;
    cart.position.y = floorAt(cartX, cartZ);
    reel.rotation.x = reelTurns * TAU;

    const matrices = new Map<THREE.InstancedMesh, number>();
    const setBox = (mesh: THREE.InstancedMesh, point: THREE.Vector3, size: [number, number, number], yaw: number, pitch = 0) => {
      const index = matrices.get(mesh) ?? 0; matrices.set(mesh, index + 1); putBox(mesh, index, point, size, yaw, pitch);
    };
    const setSphere = (mesh: THREE.InstancedMesh, point: THREE.Vector3, scale: [number, number, number], yaw = 0) => {
      const index = matrices.get(mesh) ?? 0; matrices.set(mesh, index + 1); putSphere(mesh, index, point, scale, yaw);
    };
    const setSegment = (mesh: THREE.InstancedMesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
      const index = matrices.get(mesh) ?? 0; matrices.set(mesh, index + 1); putSegment(mesh, index, a, b, radius);
    };
    const wave = .5 + .5 * Math.sin(time * 3.15);

    workers.forEach((worker, i) => {
      const [sx, sz] = worker.standby, [wx, wz] = worker.work;
      const factor = workAmount;
      const sway = Math.sin(time * 1.55 + i * 2.1) * .026;
      const step = Math.sin(time * 8.8 + i * Math.PI) * .13 * walking;
      let x = sx + (wx - sx) * factor;
      let z = sz + (wz - sz) * factor;
      const px = siteX + x, pz = siteZ + z;
      const floor = floorAt(px, pz);
      const targetX = worker.role === 'signal' ? siteX : siteX + 6;
      const targetZ = worker.role === 'signal' ? siteZ + 1.5 : siteZ;
      const yaw = Math.atan2(targetX - px, targetZ - pz);
      const crouch = worker.role === 'rigger' ? factor * .24 : 0;
      const lean = worker.role === 'rigger' ? factor * .18 : 0;
      const bodyDrop = crouch * .48 + sway;
      const body = (lx: number, ly: number, lz: number) => bodyPoint(lx, ly, lz, floor, px, pz, yaw, lean, bodyDrop);

      setBox(torsoMesh, body(0, 1.0, 0), [.52, .58, .34], yaw, lean);
      setBox(vestMesh, body(0, 1.02, .018), [.57, .5, .365], yaw, lean);
      setBox(tapeMesh, body(0, .87, .02), [.578, .045, .378], yaw, lean);
      setBox(tapeMesh, body(0, 1.15, .02), [.578, .045, .378], yaw, lean);
      setBox(pelvisMesh, localToWorld(0, floor + .64 - bodyDrop * .42, 0, px, pz, yaw), [.43, .27, .32], yaw);

      for (const side of [-1, 1]) {
        const shoulder = body(side * .31, 1.21, 0);
        let elbow: THREE.Vector3, wrist: THREE.Vector3;
        if (worker.role === 'rigger' && factor > .03) {
          elbow = body(side * .47, 1.11, .31);
          wrist = body(side * .5, 1.27, .63);
        } else if (worker.role === 'signal' && rigNear && side === 1) {
          elbow = body(side * .43, 1.4, .04 + wave * .05);
          wrist = body(side * .48, 1.5 + wave * .14, .12 + wave * .12);
        } else if (i === 0 && side === -1 && factor < .08) {
          elbow = body(-.4, 1.08, .08);
          wrist = body(-.28, .94, .29);
        } else {
          elbow = body(side * .4, .91, .035);
          wrist = body(side * .43, .72, .09);
        }
        setSegment(upperArmMesh, shoulder, elbow, .115);
        setSegment(lowerArmMesh, elbow, wrist, .091);
        setSphere(handMesh, wrist, [.105, .09, .12]);

        const hip = localToWorld(side * .14, floor + .63 - bodyDrop * .42, 0, px, pz, yaw);
        const knee = localToWorld(side * (.19 + crouch * .08), floor + .33 - crouch * .13, .08 + crouch * .17 + (side * step), px, pz, yaw);
        const ankle = localToWorld(side * .2, floor + .115, side * step, px, pz, yaw);
        setSegment(upperLegMesh, hip, knee, .145);
        setSegment(lowerLegMesh, knee, ankle, .115);
        setBox(kneeMesh, knee, [.26, .19, .18], yaw);
        const bootPoint = localToWorld(side * .2, floor + .075, .115 + side * step, px, pz, yaw);
        setBox(bootMesh, bootPoint, [.27, .15, .39], yaw, .03 * walking);
      }

      const neckA = body(0, 1.27, 0), neckB = body(0, 1.41, 0);
      setSegment(neckMesh, neckA, neckB, .09);
      const head = body(0, 1.49, 0);
      setSphere(headMesh, head, [.17, .19, .165]);
      const face = body(0, 1.485, .126);
      setSphere(faceMesh, face, [.12, .135, .073]);
      const dome = body(0, 1.685, 0);
      setSphere(helmetDomeMesh, dome, [.205, .12, .20]);
      const brim = body(0, 1.636, 0);
      setBox(helmetRimMesh, brim, [.235, .035, .235], yaw);
      for (const side of [-1, 1]) {
        const ear = body(side * .18, 1.48, .005);
        setSphere(earMesh, ear, [.062, .085, .075]);
      }
      const micStart = body(-.19, 1.45, .015), micEnd = body(-.12, 1.41, .18);
      setSegment(micMesh, micStart, micEnd, .018);
      const radio = localToWorld(.24, floor + .76, -.12, px, pz, yaw);
      setBox(radioMesh, radio, [.12, .2, .1], yaw);
      if (i === 0) {
        const checklist = body(-.12, .99, .31);
        setBox(clipboardMesh, checklist, [.29, .38, .045], yaw, .13 * (1 - factor));
      }
    });

    for (const part of parts) {
      const count = matrices.get(part.mesh) ?? 0;
      part.mesh.count = count;
      part.mesh.instanceMatrix.needsUpdate = true;
      part.mesh.visible = true;
    }
  }

  return { update };
}
