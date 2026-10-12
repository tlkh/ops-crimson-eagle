import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { campaigns } from '../content';
import { createSim } from '../sim';
import { shipLandingPoint } from '../sim/shipLanding';
import type { Campaign, Mission, SimState } from '../types';
import { createAircraftLightMounts, type AircraftLightKey, type AircraftLightPlacement } from './aircraftLighting';
import { createNightLighting } from './nightLighting';
import { createShipLightLayout } from './shipLayout';

const singapore = campaigns.find(item => item.id === 'sg_fictional_2026_10')!;
const japan = campaigns.find(item => item.id === 'jp_ketapang_2026_09')!;
const placements: Record<AircraftLightKey, AircraftLightPlacement> = {
  port: { position: [-2.4, .1, -1], direction: [-1, 0, 0] },
  starboard: { position: [2.4, .1, -1], direction: [1, 0, 0] },
  aft: { position: [0, .2, 8], direction: [0, 0, 1] },
  upperBeacon: { position: [0, 3, 6], direction: [0, .6, .8] },
  lowerBeacon: { position: [0, -.8, 6], direction: [0, -.6, .8] },
  landingPort: { position: [-.45, -.5, -7], direction: [-.04, -.4, -.91] },
  landingStarboard: { position: [.45, -.5, -7], direction: [.04, -.4, -.91] },
};

function setupLighting(campaign: Campaign, mission: Mission) {
  const scene = new THREE.Scene();
  const aircraft = new THREE.Group();
  scene.add(aircraft);
  const mounts = createAircraftLightMounts(aircraft, placements);
  const lighting = createNightLighting(scene, aircraft, campaign, mission, mounts);
  return { scene, aircraft, mounts, lighting };
}

describe('shared ship lighting layout', () => {
  it('anchors mast beacons and aft floods to each ship and the center of its flight deck', () => {
    const sg = createShipLightLayout(singapore);
    const jp = createShipLightLayout(japan);

    expect(sg.mastBeacon.x).toBe(0);
    expect(sg.mastBeacon.z).toBeCloseTo(35 - singapore.shipLength + singapore.shipLength * .395);
    expect(jp.mastBeacon.x).toBeCloseTo(japan.shipWidth * .27 - 1);
    expect(jp.mastBeacon.z).toBeCloseTo(40 - japan.shipLength + japan.shipLength * .445);
    expect(sg.deckFlood.housing.z).toBeCloseTo(-40.5 + 6 + .05);
    expect(jp.deckFlood.housing.z).toBeCloseTo((40 - japan.shipLength + japan.shipLength * .47) + japan.shipLength * .245 / 2 + .06);

    for (const layout of [sg, jp]) {
      expect(layout.deckY).toBe(-2.525);
      expect(layout.deckFlood.target.x).toBe(0);
      expect(layout.deckFlood.target.y).toBeCloseTo(-2.55 + .18);
      expect(layout.deckEdgeLamps).toHaveLength(8);
      expect(layout.deckFlood.position.z).toBeGreaterThan(layout.deckFlood.housing.z);
    }
    expect(sg.deckFlood.target.z).toBeCloseTo((-34.5 + sg.sternZ) * 0.5);
    expect(jp.deckFlood.target.z).toBeCloseTo(((40 - japan.shipLength + japan.shipLength * .47 + japan.shipLength * .245 / 2) + jp.sternZ) * 0.5);
  });

  it('rotates the deck flood position and target with the mission ship heading', () => {
    const base = japan.missions[0];
    const mission = { ...base, shipHeading: Math.PI / 3 };
    const layout = createShipLightLayout(japan);
    const { scene, lighting } = setupLighting(japan, mission);
    scene.updateMatrixWorld(true);
    const group = scene.getObjectByName('Ship navigation and deck lighting')!;
    const flood = group.getObjectByName('ship-deck-flood') as THREE.SpotLight;
    const expectedPosition = new THREE.Vector3(layout.deckFlood.position.x, layout.deckFlood.position.y, layout.deckFlood.position.z)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), mission.shipHeading)
      .add(new THREE.Vector3(mission.ship.x, 0, mission.ship.z));
    const expectedTarget = new THREE.Vector3(layout.deckFlood.target.x, layout.deckFlood.target.y, layout.deckFlood.target.z)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), mission.shipHeading)
      .add(new THREE.Vector3(mission.ship.x, 0, mission.ship.z));
    const actualPosition = flood.getWorldPosition(new THREE.Vector3());
    const actualTarget = flood.target.getWorldPosition(new THREE.Vector3());
    expect(actualPosition.distanceTo(expectedPosition)).toBeLessThan(1e-5);
    expect(actualTarget.distanceTo(expectedTarget)).toBeLessThan(1e-5);
    lighting.dispose();
  });
});

describe('ship and aircraft landing illumination', () => {
  it('assigns exactly one nearby nighttime shadow caster to the ship deck or airborne approach', () => {
    const mission = singapore.missions[0];
    const { scene, mounts, lighting } = setupLighting(singapore, mission);
    const aircraftSpot = scene.getObjectByName('aircraft-landing-illumination') as THREE.SpotLight;
    const shipSpot = scene.getObjectByName('ship-deck-flood') as THREE.SpotLight;
    expect(shipSpot.shadow).toBe(aircraftSpot.shadow);
    const state = createSim(singapore, mission);
    const landingPoint = shipLandingPoint(singapore, mission);

    state.phase = 'deck_rig';
    state.position = landingPoint;
    lighting.update(state, 1, 0);
    expect(shipSpot.intensity).toBeGreaterThan(0);
    expect(shipSpot.castShadow).toBe(true);
    expect(aircraftSpot.intensity).toBe(0);
    expect(aircraftSpot.castShadow).toBe(false);
    const steadyFloodIntensity = shipSpot.intensity;

    state.phase = 'return';
    state.position = { ...landingPoint, y: 10 };
    lighting.update(state, 1, 0);
    expect(shipSpot.intensity).toBe(steadyFloodIntensity);
    expect(aircraftSpot.intensity).toBeGreaterThan(0);
    expect(shipSpot.castShadow).toBe(false);
    expect(aircraftSpot.castShadow).toBe(true);
    expect(Number(shipSpot.castShadow) + Number(aircraftSpot.castShadow)).toBe(1);

    state.phase = 'land';
    state.position = landingPoint;
    lighting.update(state, 1, 0);
    expect(shipSpot.intensity).toBe(steadyFloodIntensity);
    expect(shipSpot.castShadow).toBe(true);
    expect(aircraftSpot.intensity).toBe(0);
    expect(aircraftSpot.castShadow).toBe(false);
    expect(Number(shipSpot.castShadow) + Number(aircraftSpot.castShadow)).toBe(1);
    lighting.dispose();
    mounts.dispose();
  });

  it('fades both local floods in daylight and derives beacon pulses only from simulation time', () => {
    const mission = singapore.missions[0];
    const { scene, mounts, lighting } = setupLighting(singapore, mission);
    const shipSpot = scene.getObjectByName('ship-deck-flood') as THREE.SpotLight;
    const aircraftSpot = scene.getObjectByName('aircraft-landing-illumination') as THREE.SpotLight;
    const state: SimState = createSim(singapore, mission);
    state.phase = 'deck_rig';
    state.position = shipLandingPoint(singapore, mission);
    state.timeSec = 0.2;

    lighting.update(state, 1, 0);
    const pulseAtPausedTime = mounts.materials.beaconRed.emissiveIntensity;
    lighting.update(state, 1, 0);
    expect(mounts.materials.beaconRed.emissiveIntensity).toBe(pulseAtPausedTime);
    state.timeSec = 0.7;
    lighting.update(state, 1, 0);
    expect(mounts.materials.beaconRed.emissiveIntensity).toBeLessThan(pulseAtPausedTime);

    lighting.update(state, 0, 1);
    expect(shipSpot.intensity).toBe(0);
    expect(aircraftSpot.intensity).toBe(0);
    expect(shipSpot.castShadow).toBe(false);
    expect(aircraftSpot.castShadow).toBe(false);
    lighting.dispose();
    mounts.dispose();
  });

  it('disposes the shared shadow targets once and removes the lighting objects', () => {
    const mission = singapore.missions[0];
    const { scene, mounts, lighting } = setupLighting(singapore, mission);
    const aircraftSpot = scene.getObjectByName('aircraft-landing-illumination') as THREE.SpotLight;
    const shipSpot = scene.getObjectByName('ship-deck-flood') as THREE.SpotLight;
    const aircraftMap = new THREE.WebGLRenderTarget(4, 4);
    aircraftSpot.shadow.map = aircraftMap;
    const disposeAircraftMap = vi.spyOn(aircraftMap, 'dispose');
    const blurMap = new THREE.WebGLRenderTarget(4, 4);
    shipSpot.shadow.mapPass = blurMap;
    const disposeBlurMap = vi.spyOn(blurMap, 'dispose');

    lighting.dispose();

    expect(disposeAircraftMap).toHaveBeenCalledOnce();
    expect(disposeBlurMap).toHaveBeenCalledOnce();
    expect(shipSpot.shadow.mapPass).toBeNull();
    expect(aircraftSpot.shadow.map).toBeNull();
    expect(shipSpot.shadow.map).toBeNull();
    expect(scene.getObjectByName('Ship navigation and deck lighting')).toBeUndefined();
    expect(scene.getObjectByName('aircraft-landing-illumination')).toBeUndefined();
    mounts.dispose();
  });
});
