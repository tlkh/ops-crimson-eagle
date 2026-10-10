import * as THREE from 'three';

export type AircraftLightKey =
  | 'port'
  | 'starboard'
  | 'aft'
  | 'upperBeacon'
  | 'lowerBeacon'
  | 'landingPort'
  | 'landingStarboard';

export type AircraftLightPlacement = {
  position: [number, number, number];
  direction: [number, number, number];
};

export type AircraftLightMaterials = {
  positionRed: THREE.MeshStandardMaterial;
  positionGreen: THREE.MeshStandardMaterial;
  aftWhite: THREE.MeshStandardMaterial;
  beaconRed: THREE.MeshStandardMaterial;
  landingWhite: THREE.MeshStandardMaterial;
};

export type AircraftLightMounts = {
  /** Empty transform groups, one per fixture. Their local +Z axis points out of each lens. */
  readonly mounts: Record<AircraftLightKey, THREE.Group>;
  /** Shared, render-owned lens materials. Do not dispose these with gameplay lighting. */
  readonly materials: AircraftLightMaterials;
  /** Removes the fixture batches and disposes their geometry and materials. */
  dispose(): void;
};

const FORWARD = new THREE.Vector3(0, 0, 1);
const BEACON_PERIOD_RATE = 5.2;

function lensMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#261d1b',
    emissive: color,
    emissiveIntensity: 0.2,
    roughness: 0.3,
    metalness: 0.02,
    toneMapped: false,
  });
}

function finiteVector(values: [number, number, number], key: AircraftLightKey, field: string): THREE.Vector3 {
  const vector = new THREE.Vector3(...values);
  if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
    throw new Error(`Aircraft light ${key} has a non-finite ${field}.`);
  }
  return vector;
}

function multiplyMountOffset(mount: THREE.Group, offset: THREE.Vector3, scale: THREE.Vector3): THREE.Matrix4 {
  const localOffset = new THREE.Matrix4().compose(offset, new THREE.Quaternion(), scale);
  return mount.matrix.clone().multiply(localOffset);
}

/**
 * Build seven restrained, directional fixtures on an aircraft model. Housing
 * and lens batches keep the lights to six draw calls while the keyed mount
 * groups remain available to lighting and inspection code.
 */
export function createAircraftLightMounts(
  parent: THREE.Object3D,
  placements: Record<AircraftLightKey, AircraftLightPlacement>,
): AircraftLightMounts {
  const mounts = {} as Record<AircraftLightKey, THREE.Group>;
  const keys: AircraftLightKey[] = [
    'port', 'starboard', 'aft', 'upperBeacon', 'lowerBeacon', 'landingPort', 'landingStarboard',
  ];

  for (const key of keys) {
    const placement = placements[key];
    const position = finiteVector(placement.position, key, 'position');
    const direction = finiteVector(placement.direction, key, 'direction');
    if (direction.lengthSq() < 1e-8) throw new Error(`Aircraft light ${key} has a zero direction.`);

    const mount = new THREE.Group();
    mount.name = `aircraft-light-mount-${key}`;
    mount.position.copy(position);
    mount.quaternion.setFromUnitVectors(FORWARD, direction.normalize());
    mount.userData.aircraftLightKey = key;
    parent.add(mount);
    mounts[key] = mount;
  }

  const materials: AircraftLightMaterials = {
    positionRed: lensMaterial('#ff2029'),
    positionGreen: lensMaterial('#22e579'),
    aftWhite: lensMaterial('#fff1d3'),
    beaconRed: lensMaterial('#ff3028'),
    landingWhite: lensMaterial('#fff6d8'),
  };
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: '#161a18',
    roughness: 0.7,
    metalness: 0.12,
  });
  // Both end faces are closed: viewed from behind, the dark cap screens the
  // recessed lens. The lens sits forward of this shell and is smaller than it.
  const housingGeometry = new THREE.CylinderGeometry(0.145, 0.145, 0.14, 12, 1, false);
  housingGeometry.rotateX(Math.PI / 2);
  const lensGeometry = new THREE.SphereGeometry(0.105, 12, 8);
  const housingBatch = new THREE.InstancedMesh(housingGeometry, housingMaterial, keys.length);
  housingBatch.name = 'aircraft-light-housings';
  housingBatch.castShadow = false;
  housingBatch.receiveShadow = false;

  const lensKeys: Record<keyof AircraftLightMaterials, AircraftLightKey[]> = {
    positionRed: ['port'],
    positionGreen: ['starboard'],
    aftWhite: ['aft'],
    beaconRed: ['upperBeacon', 'lowerBeacon'],
    landingWhite: ['landingPort', 'landingStarboard'],
  };
  const fixtureObjects: THREE.Object3D[] = [housingBatch];
  const lensOffset = new THREE.Vector3(0, 0, 0.075);

  keys.forEach((key, index) => {
    const mount = mounts[key];
    mount.updateMatrix();
    const housingDepthScale = key === 'upperBeacon' || key === 'lowerBeacon' ? 0.55 : 1;
    housingBatch.setMatrixAt(index, multiplyMountOffset(
      mount,
      new THREE.Vector3(),
      new THREE.Vector3(1, 1, housingDepthScale),
    ));
  });
  housingBatch.instanceMatrix.needsUpdate = true;
  housingBatch.computeBoundingSphere();
  parent.add(housingBatch);

  for (const [materialKey, fixtureKeys] of Object.entries(lensKeys) as [keyof AircraftLightMaterials, AircraftLightKey[]][]) {
    const batch = new THREE.InstancedMesh(lensGeometry, materials[materialKey], fixtureKeys.length);
    batch.name = `aircraft-light-lenses-${materialKey}`;
    batch.castShadow = false;
    batch.receiveShadow = false;
    fixtureKeys.forEach((key, index) => {
      const mount = mounts[key];
      mount.updateMatrix();
      const beacon = key === 'upperBeacon' || key === 'lowerBeacon';
      const lensScale = beacon
        ? new THREE.Vector3(0.78, 0.78, 0.78)
        : new THREE.Vector3(0.74, 0.74, 0.32);
      batch.setMatrixAt(index, multiplyMountOffset(mount, lensOffset, lensScale));
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingSphere();
    parent.add(batch);
    fixtureObjects.push(batch);
  }

  let disposed = false;
  const result: AircraftLightMounts = {
    mounts,
    materials,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const object of fixtureObjects) {
        object.removeFromParent();
        if (object instanceof THREE.InstancedMesh) object.dispose();
      }
      for (const mount of Object.values(mounts)) mount.removeFromParent();
      housingGeometry.dispose();
      lensGeometry.dispose();
      housingMaterial.dispose();
      Object.values(materials).forEach((material) => material.dispose());
    },
  };

  updateAircraftLightEmission(result, 0, 0);
  return result;
}

/** Simulation-time-only emissions. Repeated calls at the same time are identical. */
export function updateAircraftLightEmission(
  lightMounts: AircraftLightMounts,
  nightStrength: number,
  timeSec: number,
): void {
  const night = Number.isFinite(nightStrength) ? THREE.MathUtils.clamp(nightStrength, 0, 1) : 0;
  const time = Number.isFinite(timeSec) ? timeSec : 0;
  const pulseWave = Math.max(0, Math.sin(time * BEACON_PERIOD_RATE));
  const pulse = 0.12 + 0.88 * Math.pow(pulseWave, 12);
  const { materials } = lightMounts;

  materials.positionRed.emissiveIntensity = 0.2 + night * 2.25;
  materials.positionGreen.emissiveIntensity = 0.2 + night * 2.25;
  materials.aftWhite.emissiveIntensity = 0.18 + night * 2.15;
  materials.beaconRed.emissiveIntensity = (0.2 + night * 3.8) * pulse;
  materials.landingWhite.emissiveIntensity = 0.18 + night * 3.2;
}
