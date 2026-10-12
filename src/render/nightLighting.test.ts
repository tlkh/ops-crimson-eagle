import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { campaignTerrainFrame } from '../content/terrainFrame';
import { createJapanAirbaseFrame } from '../content/airbaseLayout';
import { createAircraftLightMounts, type AircraftLightKey, type AircraftLightPlacement } from './aircraftLighting';
import { createNightLighting } from './nightLighting';

const campaign = campaigns.find(item => item.id === 'jp_ketapang_2026_09')!;
const mission = campaign.missions[0];
const placements: Record<AircraftLightKey, AircraftLightPlacement> = {
  port: { position: [-2.4, .1, -1], direction: [-1, 0, 0] },
  starboard: { position: [2.4, .1, -1], direction: [1, 0, 0] },
  aft: { position: [0, .2, 8], direction: [0, 0, 1] },
  upperBeacon: { position: [0, 3, 6], direction: [0, .6, .8] },
  lowerBeacon: { position: [0, -.8, 6], direction: [0, -.6, .8] },
  landingPort: { position: [-.45, -.5, -7], direction: [-.04, -.4, -.91] },
  landingStarboard: { position: [.45, -.5, -7], direction: [.04, -.4, -.91] },
};

describe('Japan airfield night lighting', () => {
  it('rotates the shore floodlights with the runway while settlement lights follow terrain +T', () => {
    const scene = new THREE.Scene();
    const aircraft = new THREE.Group();
    scene.add(aircraft);
    const rig = createAircraftLightMounts(aircraft, placements);
    const lighting = createNightLighting(scene, aircraft, campaign, mission, rig);
    scene.updateMatrixWorld(true);

    const frame = createJapanAirbaseFrame(campaign, mission);
    const terrain = campaignTerrainFrame(campaign, mission);
    const shoreGroup = scene.getObjectByName('Japan shore airfield lighting')!;
    const settlementGroup = scene.getObjectByName('Coastal settlement lighting')!;
    expect(shoreGroup.position.x).toBe(mission.shore!.x);
    expect(shoreGroup.position.z).toBe(mission.shore!.z);
    expect(shoreGroup.rotation.y).toBeCloseTo(frame.heading, 10);
    expect(settlementGroup.rotation.y).toBeCloseTo(Math.atan2(terrain.ux, terrain.uz), 10);

    const localFlood = shoreGroup.localToWorld(new THREE.Vector3(25, 0, 15));
    const expectedFlood = frame.toWorld({ x: 25, z: 15 });
    expect(localFlood.x).toBeCloseTo(expectedFlood.x, 5);
    expect(localFlood.z).toBeCloseTo(expectedFlood.z, 5);

    lighting.dispose();
    rig.dispose();
  });
});
