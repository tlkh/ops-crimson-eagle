import { describe, expect, it } from 'vitest';
import { proximityParticleBudget, proximitySimulationDelta } from './proximityParticles';
import { createProximityParticles } from './proximityParticles';
import * as THREE from 'three';
import { campaigns } from '../content';
import { createSim } from '../sim';

describe('proximity particle timing and budget', () => {
  it('freezes visual time while simulation time is unchanged', () => {
    expect(proximitySimulationDelta(12.5, 12.5)).toBe(0);
  });

  it('caps a long frame after suspension', () => {
    expect(proximitySimulationDelta(4, 9)).toBe(.05);
  });

  it('resets on missing, invalid, or backwards simulation time', () => {
    expect(proximitySimulationDelta(undefined, 1)).toBe(0);
    expect(proximitySimulationDelta(3, 2)).toBe(0);
    expect(proximitySimulationDelta(3, Number.NaN)).toBe(0);
  });

  it('uses at most 64 points in phone-shaped views and 128 otherwise', () => {
    expect(proximityParticleBudget(.6)).toBe(64);
    expect(proximityParticleBudget(.819)).toBe(64);
    expect(proximityParticleBudget(.82)).toBe(128);
    expect(proximityParticleBudget(1.5)).toBe(128);
    expect(proximityParticleBudget(1.8, true)).toBe(64);
  });

  it('keeps late-sortie spray local to its emitter and freezes its pool while paused', () => {
    const campaign = campaigns[0], mission = campaign.missions[0];
    const state = createSim(campaign, mission);
    state.position = { x: mission.lake.x, y: 8, z: mission.lake.z };
    state.velocity = { x: 20, y: 0, z: 0 };
    state.phase = 'transit';
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(53, 1.6);
    const effect = createProximityParticles(scene, campaign, mission);
    const points = scene.getObjectByName('Proximity particles') as THREE.Points;
    let visible = 0;
    try {
      for (let tick = 0; tick <= 6100; tick++) {
        state.timeSec = tick * .05;
        effect.update(state, camera);
        if (tick < 6000) continue;
        const positions = points.geometry.getAttribute('position');
        const opacity = points.geometry.getAttribute('aOpacity');
        for (let i = 0; i < opacity.count; i++) {
          if (opacity.getX(i) <= .001) continue;
          visible++;
          expect(Math.hypot(positions.getX(i) - state.position.x, positions.getZ(i) - state.position.z)).toBeLessThan(18);
        }
      }
      expect(visible).toBeGreaterThan(0);
      const before = Array.from(points.geometry.getAttribute('position').array);
      effect.update(state, camera);
      expect(Array.from(points.geometry.getAttribute('position').array)).toEqual(before);
    } finally { effect.dispose(); }
    expect(scene.children).toHaveLength(0);
  });
});
