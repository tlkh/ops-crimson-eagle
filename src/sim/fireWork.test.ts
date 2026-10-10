import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { createSim, stepSim } from './index';
import type { ExtendedSimState } from './types';
import { shouldObserveFire } from './fireWork';

describe('fire observation guidance', () => {
  it('keeps every mission on the fire while released water is still in flight', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const state = createSim(campaign, mission) as ExtendedSimState;
      state.phase = 'work';
      state.dropsCompleted = mission.requiredDrops;
      state.waterPackets.push({
        litres: 25,
        position: { x: mission.fire.x, y: 20, z: mission.fire.z },
        velocity: { x: 0, y: -1, z: 0 },
        dropId: 1,
      });
      expect(shouldObserveFire(state, mission), `${campaign.id}/${mission.id}`).toBe(true);

      state.waterPackets = [];
      state.airborneLitres = 0.01;
      expect(shouldObserveFire(state, mission), `${campaign.id}/${mission.id} airborne`).toBe(true);
    }
  });

  it('waits for the final fire threshold, while peat can finish through ground-crew work', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const state = createSim(campaign, mission) as ExtendedSimState;
      state.phase = 'work';
      state.dropsCompleted = mission.requiredDrops;
      state.fireHeat = mission.peat ? 30 : 8;
      expect(shouldObserveFire(state, mission), `${campaign.id}/${mission.id} final threshold`).toBe(true);

      state.fireHeat += 0.01;
      expect(shouldObserveFire(state, mission), `${campaign.id}/${mission.id} needs more water`).toBe(false);
      state.fireHeat = mission.peat ? 30 : 8;
      state.objectiveSaved = true;
      expect(shouldObserveFire(state, mission), `${campaign.id}/${mission.id} secured`).toBe(false);
    }
  });

  it('still asks for another load when the required drop count is incomplete', () => {
    const campaign = campaigns[0];
    const mission = campaign.missions[1];
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'work';
    state.dropsCompleted = mission.requiredDrops - 1;
    state.fireHeat = 0;
    expect(shouldObserveFire(state, mission)).toBe(false);
  });

  it('does not hold the fire observation objective after leaving the work phases', () => {
    const campaign = campaigns[0];
    const mission = campaign.missions[0];
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'return';
    state.airborneLitres = 500;
    expect(shouldObserveFire(state, mission)).toBe(false);
  });
});


it('lets crews finish at the exact suppression threshold in every mission, then routes home', () => {
  for (const campaign of campaigns) for (const mission of campaign.missions) {
    const state = createSim(campaign, mission) as ExtendedSimState;
    Object.assign(state, {
      phase: 'work', position: { x: mission.fire.x, y: 100, z: mission.fire.z },
      velocity: { x: 0, y: 0, z: 0 }, bucketAttached: true, bucketLocation: 'aircraft',
      bucket: { x: mission.fire.x, y: 78, z: mission.fire.z },
      dropsCompleted: mission.requiredDrops, fireHeat: mission.peat ? 30 : 8,
      peatHeat: 30, crewProgress: 0, waterLitres: 0,
    });
    const idle = { yaw: 0, climb: 0, cyclicX: 0, cyclicY: 0, drop: false, fetch: false, faceObjective: false, returnHome: false, action: false };
    for (let tick = 0; tick < 40 * 60 && !state.objectiveSaved; tick++) {
      stepSim(state, idle, campaign, mission);
      if (!state.objectiveSaved) expect(state.guidance.label, mission.id).toBe('Observe fire');
    }
    expect(state.objectiveSaved, mission.id).toBe(true);
    expect(state.phase, mission.id).toBe('return');
    expect(state.guidance.label, mission.id).not.toBe('Freshwater lake');
  }
});
