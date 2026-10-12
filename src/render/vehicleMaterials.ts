import * as THREE from 'three';

export interface VehiclePaintMaps {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
}

export interface VehiclePaintMaterialOptions extends VehiclePaintMaps {
  color: THREE.ColorRepresentation;
  name: string;
  roughness: number;
  metalness: number;
  normalScale?: THREE.Vector2;
  aoMapIntensity?: number;
  envMapIntensity?: number;
}

/** Use the existing authored paint atlases with a soft, readable environment response. */
export function createVehiclePaintMaterial(options: VehiclePaintMaterialOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    map: options.map ?? null,
    normalMap: options.normalMap ?? null,
    roughnessMap: options.roughnessMap ?? null,
    aoMap: options.aoMap ?? null,
    roughness: options.roughness,
    metalness: options.metalness,
    normalScale: options.normalScale ?? new THREE.Vector2(1, 1),
    aoMapIntensity: options.aoMapIntensity ?? 1,
    envMapIntensity: options.envMapIntensity ?? 1.24,
  });
  material.name = options.name;
  return material;
}

/** Opaque tinted glazing catches sky reflections without a transmission pass. */
export function createVehicleGlassMaterial(
  color: THREE.ColorRepresentation,
  name: string,
  options: { roughness?: number; clearcoat?: number; envMapIntensity?: number } = {},
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: options.roughness ?? .24,
    metalness: .025,
    clearcoat: options.clearcoat ?? .55,
    clearcoatRoughness: .18,
    reflectivity: .72,
    envMapIntensity: options.envMapIntensity ?? 1.42,
    side: THREE.DoubleSide,
  });
  material.name = name;
  return material;
}

/** Shared opaque fittings use slightly stronger authored-sky response than terrain props. */
export function createVehicleMaterial(
  color: THREE.ColorRepresentation,
  roughness = .78,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, envMapIntensity: 1.18, ...extra });
}
