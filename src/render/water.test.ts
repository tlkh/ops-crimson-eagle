import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getCampaign } from '../content';
import { createWater } from './water';

describe('water reflection quality', () => {
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
