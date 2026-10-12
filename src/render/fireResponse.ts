import * as THREE from 'three';
import type { Campaign, Mission, SimState, Vec3 } from '../types';
import type { RenderQualityProfile } from './quality';
import { sampleFireResponse, type FirefighterPose, type FireEnginePose, type FireResponseFrame } from '../sim/fireResponse';

type Instance = THREE.InstancedMesh;
const PERSON_COUNT = 6;
const ENGINE_COUNT = 2;

/** Compact simulation-clocked responders, engines, and short staging hoses. */
export function createFireResponse(
  scene: THREE.Scene,
  campaign: Campaign,
  mission: Mission,
  options: { preview?: boolean; profile?: RenderQualityProfile } = {},
): { update(state: Pick<SimState, 'timeSec' | 'fireState'>): void; setQuality(profile: RenderQualityProfile): void; dispose(): void } {
  const root = new THREE.Group();
  root.name = 'Ambient fire response';
  scene.add(root);

  const coverall = new THREE.MeshStandardMaterial({ color: '#263a3c', roughness: .94 });
  const vest = new THREE.MeshStandardMaterial({ color: '#df8b24', emissive: '#3d1900', roughness: .8 });
  const reflective = new THREE.MeshStandardMaterial({ color: '#e5dfbd', emissive: '#29271c', roughness: .58, metalness: .06 });
  const skin = new THREE.MeshStandardMaterial({ color: '#a66b4f', roughness: .95 });
  const helmet = new THREE.MeshStandardMaterial({ color: '#e7a733', roughness: .62 });
  const boot = new THREE.MeshStandardMaterial({ color: '#20292b', roughness: .86 });
  const red = new THREE.MeshStandardMaterial({ color: '#c52b21', roughness: .68, metalness: .08 });
  const redDark = new THREE.MeshStandardMaterial({ color: '#87231e', roughness: .74, metalness: .08 });
  const glass = new THREE.MeshStandardMaterial({ color: '#283d45', roughness: .28, metalness: .08 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#222626', roughness: .9 });
  const steel = new THREE.MeshStandardMaterial({ color: '#727773', roughness: .55, metalness: .58 });
  const hoseMaterial = new THREE.MeshStandardMaterial({ color: '#a69a68', roughness: .98 });
  const sprayMaterial = new THREE.MeshStandardMaterial({ color: '#9ed2d3', emissive: '#274344', transparent: true, opacity: .72, depthWrite: false, roughness: .28 });
  const geometries: THREE.BufferGeometry[] = [];
  const materials = [coverall, vest, reflective, skin, helmet, boot, red, redDark, glass, rubber, steel, hoseMaterial, sprayMaterial];

  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string): Instance => {
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.count = count;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);
    return mesh;
  };
  const boxes = (material: THREE.Material, count: number, name: string) => instanced(new THREE.BoxGeometry(1, 1, 1), material, count, name);
  const cylinders = (material: THREE.Material, count: number, name: string, radialSegments = 8) => instanced(new THREE.CylinderGeometry(1, 1, 1, radialSegments), material, count, name);
  const spheres = (material: THREE.Material, count: number, name: string, widthSegments = 8, heightSegments = 6) => instanced(new THREE.SphereGeometry(1, widthSegments, heightSegments), material, count, name);

  const torsoMesh = boxes(coverall, PERSON_COUNT, 'Responder coveralls');
  const vestMesh = boxes(vest, PERSON_COUNT, 'High visibility vests');
  const reflectiveMesh = boxes(reflective, PERSON_COUNT * 2, 'Reflective bands');
  const pelvisMesh = boxes(coverall, PERSON_COUNT, 'Responder belts');
  const upperLegMesh = cylinders(coverall, PERSON_COUNT * 2, 'Upper legs');
  const lowerLegMesh = cylinders(coverall, PERSON_COUNT * 2, 'Lower legs');
  const bootMesh = boxes(boot, PERSON_COUNT * 2, 'Work boots');
  const upperArmMesh = cylinders(coverall, PERSON_COUNT * 2, 'Upper arms');
  const lowerArmMesh = cylinders(coverall, PERSON_COUNT * 2, 'Forearms');
  const handMesh = spheres(boot, PERSON_COUNT * 2, 'Gloves');
  const faceMesh = spheres(skin, PERSON_COUNT, 'Faces', 9, 7);
  const helmetMesh = spheres(helmet, PERSON_COUNT, 'Safety helmets', 9, 6);
  const helmetRimMesh = cylinders(helmet, PERSON_COUNT, 'Helmet brims', 10);

  const engineMeshes = {
    body: boxes(red, ENGINE_COUNT, 'Fire engine bodies'),
    cab: boxes(red, ENGINE_COUNT, 'Fire engine cabs'),
    bonnet: boxes(redDark, ENGINE_COUNT, 'Fire engine bonnets'),
    windshield: boxes(glass, ENGINE_COUNT, 'Fire engine windshields'),
    sideWindow: boxes(glass, ENGINE_COUNT * 2, 'Fire engine side windows'),
    bumper: boxes(steel, ENGINE_COUNT, 'Fire engine bumpers'),
    grille: boxes(rubber, ENGINE_COUNT, 'Fire engine grilles'),
    wheels: cylinders(rubber, ENGINE_COUNT * 6, 'Fire engine wheels', 10),
    wheelHubs: cylinders(steel, ENGINE_COUNT * 6, 'Fire engine wheel hubs', 8),
    tank: boxes(redDark, ENGINE_COUNT, 'Fire engine equipment tanks'),
    ladder: boxes(steel, ENGINE_COUNT, 'Fire engine roof ladders'),
    lightbar: boxes(steel, ENGINE_COUNT, 'Fire engine light bars'),
    lamps: boxes(helmet, ENGINE_COUNT * 2, 'Fire engine beacons'),
  };
  const hoseGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  geometries.push(hoseGeometry);
  const hoseMesh = new THREE.InstancedMesh(hoseGeometry, hoseMaterial, 4);
  hoseMesh.name = 'Short staging hose lines';
  hoseMesh.count = 4;
  hoseMesh.castShadow = false;
  hoseMesh.receiveShadow = true;
  hoseMesh.frustumCulled = false;
  hoseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(hoseMesh);
  const sprayGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  geometries.push(sprayGeometry);
  const sprayMesh = new THREE.InstancedMesh(sprayGeometry, sprayMaterial, 4);
  sprayMesh.name = 'Short firefighting spray streams';
  sprayMesh.count = 4;
  sprayMesh.castShadow = false;
  sprayMesh.receiveShadow = false;
  sprayMesh.frustumCulled = false;
  sprayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(sprayMesh);

  const dummy = new THREE.Object3D();
  const axisY = new THREE.Vector3(0, 1, 0);
  const delta = new THREE.Vector3();
  const compose = (position: THREE.Vector3, size: [number, number, number], yaw = 0, pitch = 0, roll = 0) => {
    dummy.position.copy(position);
    dummy.rotation.set(pitch, yaw, roll, 'YXZ');
    dummy.scale.set(...size);
    dummy.updateMatrix();
    return dummy.matrix;
  };
  const localPoint = (pose: { position: Vec3; heading: number }, x: number, y: number, z: number) => {
    const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
    return new THREE.Vector3(
      pose.position.x + c * x + s * z,
      pose.position.y + y,
      pose.position.z - s * x + c * z,
    );
  };
  const putSegment = (mesh: Instance, index: number, a: THREE.Vector3, b: THREE.Vector3, radius: number) => {
    delta.subVectors(b, a);
    const length = Math.max(.01, delta.length());
    dummy.position.copy(a).add(b).multiplyScalar(.5);
    dummy.quaternion.setFromUnitVectors(axisY, delta.normalize());
    dummy.scale.set(radius, length, radius);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  };
  const putBox = (mesh: Instance, index: number, pose: { position: Vec3; heading: number }, x: number, y: number, z: number,
    size: [number, number, number], pitch = 0) => mesh.setMatrixAt(index, compose(localPoint(pose, x, y, z), size, pose.heading, pitch));

  let detail: 'high' | 'low' = options.profile?.detail ?? 'high';
  let latest: FireResponseFrame | null = null;
  let latestState: Pick<SimState, 'timeSec' | 'fireState'> = { timeSec: 0, fireState: 'burning' };

  const updatePeople = (people: readonly FirefighterPose[]) => {
    people.forEach((person, index) => {
      const pose = { position: person.position, heading: person.heading };
      const phase = person.gaitPhase;
      const walking = person.activity === 'walk' && person.motion > .5;
      const stride = walking ? Math.sin(phase) * .22 : Math.sin(phase * .45) * person.motion * .035;
      const sway = Math.sin(phase * .7 + .4) * person.motion * .045;
      const lean = person.activity === 'hose' ? -.055 : 0;
      const pitch = lean + sway;
      putBox(torsoMesh, index, pose, 0, 1.13, 0, [.43, .58, .31], pitch);
      putBox(vestMesh, index, pose, 0, 1.16, .01, [.47, .48, .34], pitch);
      putBox(reflectiveMesh, index * 2, pose, 0, 1.28, .188, [.47, .055, .026], pitch);
      putBox(reflectiveMesh, index * 2 + 1, pose, 0, 1.05, .188, [.47, .055, .026], pitch);
      putBox(pelvisMesh, index, pose, 0, .79, 0, [.34, .19, .27]);
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex === 0 ? -1 : 1;
        const swing = side * stride;
        const hip = localPoint(pose, side * .115, .73, 0);
        const knee = localPoint(pose, side * .125, .42, swing * .68);
        const ankle = localPoint(pose, side * .135, .14, swing);
        putSegment(upperLegMesh, index * 2 + sideIndex, hip, knee, .105);
        putSegment(lowerLegMesh, index * 2 + sideIndex, knee, ankle, .083);
        const bootPosition = localPoint(pose, side * .135, .085, swing + .08);
        bootMesh.setMatrixAt(index * 2 + sideIndex, compose(bootPosition, [.22, .15, .34], pose.heading));

        const shoulder = localPoint(pose, side * .27, 1.38, 0);
        const armSwing = walking ? -swing * .75 : Math.sin(phase * .65 + side) * person.motion * .045;
        const elbow = person.activity === 'hose'
          ? localPoint(pose, side * .36, 1.2, .12 + armSwing)
          : localPoint(pose, side * .39, 1.13, armSwing);
        const hand = person.activity === 'hose'
          ? localPoint(pose, side * .33, 1.08, .36 + armSwing)
          : localPoint(pose, side * .4, .9, armSwing + .04);
        putSegment(upperArmMesh, index * 2 + sideIndex, shoulder, elbow, .075);
        putSegment(lowerArmMesh, index * 2 + sideIndex, elbow, hand, .06);
        handMesh.setMatrixAt(index * 2 + sideIndex, compose(hand, [.085, .075, .08], pose.heading));
      }
      faceMesh.setMatrixAt(index, compose(localPoint(pose, 0, 1.62, .015), [.17, .19, .17], pose.heading));
      helmetMesh.setMatrixAt(index, compose(localPoint(pose, 0, 1.78, 0), [.21, .15, .21], pose.heading));
      helmetRimMesh.setMatrixAt(index, compose(localPoint(pose, 0, 1.71, 0), [.235, .035, .235], pose.heading));
    });
    for (const mesh of [torsoMesh, vestMesh, reflectiveMesh, pelvisMesh, upperLegMesh, lowerLegMesh, bootMesh, upperArmMesh, lowerArmMesh, handMesh, faceMesh, helmetMesh, helmetRimMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    reflectiveMesh.visible = detail === 'high';
  };

  const updateEngines = (engines: readonly FireEnginePose[], time: number) => {
    for (const [index, engine] of engines.entries()) {
      const pose = { position: engine.position, heading: engine.heading };
      putBox(engineMeshes.body, index, pose, 0, .95, -.12, [2.5, 1.18, 5.45]);
      putBox(engineMeshes.cab, index, pose, 0, 1.77, 1.46, [2.38, 1.33, 2.42]);
      putBox(engineMeshes.bonnet, index, pose, 0, 1.32, 2.65, [2.4, .62, .95]);
      putBox(engineMeshes.windshield, index, pose, 0, 2.1, 2.64, [2.08, .68, .045], -.12);
      for (const [sideIndex, side] of [-1, 1].entries()) {
        putBox(engineMeshes.sideWindow, index * 2 + sideIndex, pose, side * 1.205, 2.04, 1.5, [.04, .61, 1.1]);
      }
      putBox(engineMeshes.bumper, index, pose, 0, .42, 3.16, [2.9, .24, .36]);
      putBox(engineMeshes.grille, index, pose, 0, 1.14, 3.14, [.82, .48, .06]);
      putBox(engineMeshes.tank, index, pose, 0, 1.83, -.87, [2.16, .67, 2.3]);
      putBox(engineMeshes.ladder, index, pose, 0, 2.22, -.85, [.3, .12, 3.8]);
      putBox(engineMeshes.lightbar, index, pose, 0, 2.51, 1.48, [1.56, .15, .33]);
      for (let lamp = 0; lamp < 2; lamp++) {
        const side = lamp === 0 ? -1 : 1;
        putBox(engineMeshes.lamps, index * 2 + lamp, pose, side * .49, 2.55, 1.48, [.36, .2, .34]);
      }
      const wheelPositions: Array<[number, number]> = [
        [-1.28, -2.05], [1.28, -2.05], [-1.28, -.15], [1.28, -.15], [-1.28, 2.0], [1.28, 2.0],
      ];
      wheelPositions.forEach(([x, z], wheelIndex) => {
        const n = index * 6 + wheelIndex;
        const center = localPoint(pose, x, .43, z);
        const wheelSpin = engine.speed > .1 ? time * engine.speed / .43 : 0;
        engineMeshes.wheels.setMatrixAt(n, compose(center, [.43, .25, .43], pose.heading, wheelSpin, Math.PI / 2));
        const hub = localPoint(pose, x * 1.01, .43, z);
        engineMeshes.wheelHubs.setMatrixAt(n, compose(hub, [.21, .27, .21], pose.heading, wheelSpin, Math.PI / 2));
      });
    }
    for (const mesh of Object.values(engineMeshes)) mesh.instanceMatrix.needsUpdate = true;
    if (detail === 'low') {
      engineMeshes.ladder.visible = false;
      engineMeshes.wheelHubs.visible = false;
    } else {
      engineMeshes.ladder.visible = true;
      engineMeshes.wheelHubs.visible = true;
    }
  };

  const updateHoses = (frame: FireResponseFrame) => {
    let hoseInstance = 0, sprayInstance = 0;
    for (const hose of frame.hoses) {
      for (let i = 1; i < hose.points.length; i++) {
        const mesh = hose.kind === 'spray' ? sprayMesh : hoseMesh;
        const instance = hose.kind === 'spray' ? sprayInstance++ : hoseInstance++;
        const radius = hose.kind === 'spray' ? .055 : .042;
        putSegment(mesh, instance, new THREE.Vector3(hose.points[i - 1].x, hose.points[i - 1].y, hose.points[i - 1].z),
          new THREE.Vector3(hose.points[i].x, hose.points[i].y, hose.points[i].z), radius);
      }
    }
    for (; hoseInstance < hoseMesh.count; hoseInstance++) putSegment(hoseMesh, hoseInstance, new THREE.Vector3(0, -10000, 0), new THREE.Vector3(0, -10000, .01), .042);
    for (; sprayInstance < sprayMesh.count; sprayInstance++) putSegment(sprayMesh, sprayInstance, new THREE.Vector3(0, -10000, 0), new THREE.Vector3(0, -10000, .01), .055);
    hoseMesh.instanceMatrix.needsUpdate = true;
    sprayMesh.instanceMatrix.needsUpdate = true;
    hoseMesh.visible = detail === 'high';
    sprayMesh.visible = detail === 'high';
  };

  const refresh = (state: Pick<SimState, 'timeSec' | 'fireState'>) => {
    const time = options.preview ? 0 : Math.max(0, Number.isFinite(state.timeSec) ? state.timeSec : 0);
    latest = sampleFireResponse(campaign, mission, time, state.fireState === 'secured');
    updatePeople(latest.people);
    updateEngines(latest.engines, time);
    updateHoses(latest);
  };
  const setQuality = (profile: RenderQualityProfile) => {
    detail = profile.detail;
    if (latestState) refresh(latestState);
  };
  const update = (state: Pick<SimState, 'timeSec' | 'fireState'>) => { latestState = state; refresh(state); };
  refresh(latestState);
  if (options.profile) setQuality(options.profile);

  return {
    update,
    setQuality,
    dispose() {
      scene.remove(root);
      root.traverse(object => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
