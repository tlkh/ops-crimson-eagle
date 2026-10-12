import { expect, it } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { campaignTerrainFrame } from '../content/terrainFrame';
import { createWater } from './water';

it('keeps shader coast coordinates fixed when the lake moves inland', () => {
  for (const campaign of campaigns) {
    const original = campaign.missions[0];
    const moved = { ...original, lake: { ...original.lake, x: original.lake.x + 500, z: original.lake.z + 600 } };
    const water = createWater(new THREE.Scene(), campaign, moved, { reflections: false });
    const geometry = new THREE.PlaneGeometry(20, 20);
    const sea = water.surface(geometry, 0, new THREE.Vector3());
    const uniforms = (sea.material as THREE.ShaderMaterial).uniforms;
    const frame = campaignTerrainFrame(campaign);
    expect(uniforms.coastStart.value).toBeCloseTo(frame.length * .42);
    expect((uniforms.coast.value as THREE.Vector4).toArray()).toEqual([frame.origin.x, frame.origin.z, frame.ux, frame.uz]);
    expect((uniforms.lake.value as THREE.Vector3).toArray()).toEqual([moved.lake.x, moved.lake.z, moved.lake.radius]);
    water.dispose();
    geometry.dispose();
  }
});
