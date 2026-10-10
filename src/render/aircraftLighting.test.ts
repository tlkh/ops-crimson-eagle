import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Campaign, Mission } from '../types';
import {
  createAircraftLightMounts,
  updateAircraftLightEmission,
  type AircraftLightKey,
  type AircraftLightPlacement,
} from './aircraftLighting';
import { createNightLighting } from './nightLighting';

const placements: Record<AircraftLightKey, AircraftLightPlacement> = {
  port: { position: [-2.4, 0.1, -1], direction: [-1, 0, 0] },
  starboard: { position: [2.4, 0.1, -1], direction: [1, 0, 0] },
  aft: { position: [0, 0.2, 8], direction: [0, 0, 1] },
  upperBeacon: { position: [0, 3, 6], direction: [0, 0.6, 0.8] },
  lowerBeacon: { position: [0, -0.8, 6], direction: [0, -0.6, 0.8] },
  landingPort: { position: [-0.45, -0.5, -7], direction: [-0.04, -0.4, -0.91] },
  landingStarboard: { position: [0.45, -0.5, -7], direction: [0.04, -0.4, -0.91] },
};

function rigUnder(parent: THREE.Object3D) {
  return createAircraftLightMounts(parent, placements);
}

function lensBatch(parent: THREE.Object3D, name: string): THREE.InstancedMesh {
  let found: THREE.InstancedMesh | undefined;
  parent.traverse((object) => {
    if (object.name === name && object instanceof THREE.InstancedMesh) found = object;
  });
  if (!found) throw new Error(`Missing fixture batch ${name}.`);
  return found;
}

describe('Chinook aircraft lighting', () => {
  it('keeps seven keyed fixtures aimed outward with recessed lenses and dark rear caps', () => {
    const root = new THREE.Group();
    const rig = rigUnder(root);
    root.updateMatrixWorld(true);

    for (const [key, placement] of Object.entries(placements) as [AircraftLightKey, AircraftLightPlacement][]) {
      const mount = rig.mounts[key];
      expect(mount.parent).toBe(root);
      expect(mount.userData.aircraftLightKey).toBe(key);
      expect(mount.position.toArray()).toEqual(placement.position);
      const actualForward = mount.getWorldDirection(new THREE.Vector3());
      expect(actualForward.dot(new THREE.Vector3(...placement.direction).normalize())).toBeCloseTo(1, 5);

      const materialKey = key === 'port' ? 'positionRed'
        : key === 'starboard' ? 'positionGreen'
          : key === 'aft' ? 'aftWhite'
            : key === 'upperBeacon' || key === 'lowerBeacon' ? 'beaconRed'
              : 'landingWhite';
      const batch = lensBatch(root, `aircraft-light-lenses-${materialKey}`);
      const instanceIndex = materialKey === 'beaconRed' && key === 'lowerBeacon' ? 1
        : materialKey === 'landingWhite' && key === 'landingStarboard' ? 1 : 0;
      const lensMatrix = new THREE.Matrix4();
      batch.getMatrixAt(instanceIndex, lensMatrix);
      const lensPosition = new THREE.Vector3();
      const lensOrientation = new THREE.Quaternion();
      lensMatrix.decompose(lensPosition, lensOrientation, new THREE.Vector3());
      const lensScale = new THREE.Vector3();
      lensMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), lensScale);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(lensOrientation);
      expect(forward.dot(actualForward)).toBeCloseTo(1, 5);
      expect(lensPosition.clone().sub(mount.getWorldPosition(new THREE.Vector3())).dot(actualForward)).toBeCloseTo(0.075, 5);
      if (key === 'upperBeacon' || key === 'lowerBeacon') expect(lensScale.z).toBeGreaterThan(lensScale.x * 0.9);
      else expect(lensScale.z).toBeLessThan(lensScale.x * 0.5);
    }

    const housing = lensBatch(root, 'aircraft-light-housings');
    expect(housing.count).toBe(7);
    const beaconHousing = new THREE.Matrix4();
    const navHousing = new THREE.Matrix4();
    housing.getMatrixAt(3, beaconHousing);
    housing.getMatrixAt(0, navHousing);
    const beaconScale = new THREE.Vector3();
    const navScale = new THREE.Vector3();
    beaconHousing.decompose(new THREE.Vector3(), new THREE.Quaternion(), beaconScale);
    navHousing.decompose(new THREE.Vector3(), new THREE.Quaternion(), navScale);
    expect(beaconScale.z).toBeLessThan(navScale.z);
    const normalZ = Array.from(housing.geometry.getAttribute('normal').array as ArrayLike<number>)
      .filter((_, index) => index % 3 === 2);
    expect(normalZ.some((z) => z < -0.95)).toBe(true);
    expect(normalZ.some((z) => z > 0.95)).toBe(true);

    const batches: THREE.InstancedMesh[] = [];
    root.traverse((object) => { if (object instanceof THREE.InstancedMesh) batches.push(object); });
    expect(batches).toHaveLength(6);
    rig.dispose();
  });

  it('uses the correct nav colors and emits reproducible simulation-time beacon pulses', () => {
    const root = new THREE.Group();
    const rig = rigUnder(root);
    expect(rig.materials.positionRed.emissive.getHexString()).toBe('ff2029');
    expect(rig.materials.positionGreen.emissive.getHexString()).toBe('22e579');
    expect(rig.materials.aftWhite.emissive.getHexString()).toBe('fff1d3');
    expect(rig.materials.beaconRed.emissive.getHexString()).toBe('ff3028');
    expect(rig.materials.landingWhite.emissive.getHexString()).toBe('fff6d8');

    updateAircraftLightEmission(rig, 0, 0);
    const dayPulse = rig.materials.beaconRed.emissiveIntensity;
    updateAircraftLightEmission(rig, 1, 0);
    const nightPulse = rig.materials.beaconRed.emissiveIntensity;
    expect(nightPulse).toBeGreaterThan(dayPulse);
    expect(rig.materials.positionRed.emissiveIntensity).toBeCloseTo(2.45);
    expect(rig.materials.landingWhite.emissiveIntensity).toBeCloseTo(3.38);

    const peakTime = Math.PI / (2 * 5.2);
    updateAircraftLightEmission(rig, 0.65, peakTime);
    const peak = rig.materials.beaconRed.emissiveIntensity;
    updateAircraftLightEmission(rig, 0.65, peakTime);
    expect(rig.materials.beaconRed.emissiveIntensity).toBe(peak);
    updateAircraftLightEmission(rig, 0.65, 0);
    expect(rig.materials.beaconRed.emissiveIntensity).toBeLessThan(peak);
    rig.dispose();
  });

  it('keeps geometry-owned fixture materials alive when gameplay lighting is disposed', () => {
    const scene = new THREE.Scene();
    const aircraft = new THREE.Group();
    scene.add(aircraft);
    const rig = rigUnder(aircraft);
    const campaign = { id: 'sg_fictional_2026_10', shipLength: 55, shipWidth: 16 } as Campaign;
    const mission = {
      ship: { x: 0, z: 0 },
      lake: { x: 60, z: 20, radius: 18 },
      fire: { x: 120, z: -30, radius: 16 },
    } as Mission;
    const nightLighting = createNightLighting(scene, aircraft, campaign, mission, rig);
    const landingSpot = aircraft.getObjectByName('aircraft-landing-illumination') as THREE.SpotLight;
    expect(landingSpot.position.toArray()).toEqual([0, -0.5, -7]);
    expect(aircraft.children.filter((object) => object instanceof THREE.PointLight)).toHaveLength(0);
    let beaconDisposed = false;
    rig.materials.beaconRed.addEventListener('dispose', () => { beaconDisposed = true; });

    nightLighting.dispose();
    expect(beaconDisposed).toBe(false);
    expect(rig.mounts.port.parent).toBe(aircraft);
    expect(rig.materials.beaconRed.emissive.getHexString()).toBe('ff3028');

    rig.dispose();
    expect(beaconDisposed).toBe(true);
    expect(rig.mounts.port.parent).toBeNull();
  });
});
