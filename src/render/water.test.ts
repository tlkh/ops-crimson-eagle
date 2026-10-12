import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getCampaign } from '../content';
import { createWater, reflectedSceneSignature } from './water';
import { createSim } from '../sim';

describe('water reflection quality', () => {
  it('detects late texture swaps, material edits, and scene motion while paused', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshStandardMaterial({ roughness: .8 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
    scene.updateMatrixWorld(true);
    const initial = reflectedSceneSignature(scene);
    material.roughness = .5;
    const materialChanged = reflectedSceneSignature(scene);
    expect(materialChanged).not.toBe(initial);

    const loadedTexture = new THREE.DataTexture(new Uint8Array([40, 70, 60, 255]), 1, 1);
    loadedTexture.needsUpdate = true;
    material.map = loadedTexture;
    material.needsUpdate = true;
    const textureChanged = reflectedSceneSignature(scene);
    expect(textureChanged).not.toBe(materialChanged);

    mesh.position.x = 2;
    scene.updateMatrixWorld(true);
    expect(reflectedSceneSignature(scene)).not.toBe(textureChanged);
    mesh.geometry.dispose();
    material.dispose();
    loadedTexture.dispose();
  });

  it('discards the old camera reflection when leaving a water surface', () => {
    const campaign = getCampaign('sg_fictional_2026_10')!;
    const mission = campaign.missions[0];
    const water = createWater(new THREE.Scene(), campaign, mission);
    const geometry = new THREE.PlaneGeometry(20, 20);
    const sea = water.surface(geometry, 0, new THREE.Vector3());
    const lake = water.surface(geometry, 1, new THREE.Vector3());
    const seaReady = (sea.material as THREE.ShaderMaterial).uniforms.reflectionReady;
    const lakeReady = (lake.material as THREE.ShaderMaterial).uniforms.reflectionReady;
    const state = createSim(campaign, mission);
    seaReady.value = lakeReady.value = 1;
    state.position = { x: mission.lake.x, y: 25, z: mission.lake.z };
    water.update(1, state);
    expect(seaReady.value).toBe(0);
    expect(lakeReady.value).toBe(1);
    state.position = { x: mission.ship.x, y: 25, z: mission.ship.z };
    water.update(2, state);
    expect(lakeReady.value).toBe(0);
    water.dispose();
    geometry.dispose();
  });

  it('resizes live reflection targets and applies the initial quality to new surfaces', () => {
    const campaign = getCampaign('sg_fictional_2026_10')!;
    const mission = campaign.missions[0];
    const scene = new THREE.Scene();
    const water = createWater(scene, campaign, mission, { reflectionSize: 256, reflections: false });
    const geometry = new THREE.PlaneGeometry(20, 20);
    const surface = water.surface(geometry, 0, new THREE.Vector3());

    expect(surface.getRenderTarget().width).toBe(256);
    water.setQuality({ reflectionSize: 512, reflectionIntervalMs: 130, reflections: true });
    expect(surface.getRenderTarget().width).toBe(512);

    water.setQuality({ reflectionSize: 256, reflectionIntervalMs: 50, reflections: false });
    const lake = water.surface(new THREE.CircleGeometry(12, 16), 1, new THREE.Vector3());
    expect(surface.getRenderTarget().height).toBe(256);
    expect(lake.getRenderTarget().width).toBe(256);

    water.dispose();
    geometry.dispose();
    lake.geometry.dispose();
  });
});
