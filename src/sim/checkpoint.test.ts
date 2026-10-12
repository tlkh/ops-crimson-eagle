import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { WORLD_REVISION } from '../worldRevision';
import { setTreeColliders } from './collision';
import { checkpointIntersectsWorld, createSim } from './index';
import { clearRelocatedObjectiveActions } from './checkpoint';
import type { ExtendedSimState } from './types';

describe('saved sortie compatibility with new scenery', () => {
  const campaign = campaigns[0];
  const mission = { ...campaign.missions[0] };

  it('keeps a clear legacy aircraft at its saved position', () => {
    setTreeColliders(mission, []);
    const saved = createSim(campaign, mission);
    delete saved.worldRevision;
    const original = structuredClone(saved);

    expect(checkpointIntersectsWorld(saved, campaign, mission)).toBe(false);
    expect(saved).toEqual(original);
    expect(createSim(campaign, mission).worldRevision).toBe(WORLD_REVISION);
  });

  it('detects a new tree intersecting the rotor without changing the save', () => {
    const saved = createSim(campaign, mission);
    delete saved.worldRevision;
    setTreeColliders(mission, [{
      x: saved.position.x, z: saved.position.z + 8,
      ground: 0, height: 8, radius: 7,
    }]);
    const original = structuredClone(saved);

    expect(checkpointIntersectsWorld(saved, campaign, mission)).toBe(true);
    expect(saved).toEqual(original);
    setTreeColliders(mission, []);
  });

  it('detects an attached bucket buried in changed land', () => {
    setTreeColliders(mission, []);
    const saved = createSim(campaign, mission);
    saved.bucketAttached = true;
    saved.bucketLocation = 'aircraft';
    saved.bucket = { x: mission.fire.x, y: -4, z: mission.fire.z };

    expect(checkpointIntersectsWorld(saved, campaign, mission)).toBe(true);
  });

  it('cancels actions at relocated objectives while retaining in-flight water and progress', () => {
    const saved = createSim(campaign, mission) as ExtendedSimState;
    saved.position = { x: mission.lake.x - 200, y: 25, z: mission.lake.z };
    saved.precisionAction = 'fetch';
    saved.fetching = true;
    saved.dropsCompleted = 1;
    saved.waterPackets = [{ litres: 100, position: { ...saved.position }, velocity: { x: 0, y: -10, z: 0 }, dropId: 1 }];
    const packets = structuredClone(saved.waterPackets);
    clearRelocatedObjectiveActions(saved, mission);
    expect(saved.precisionAction).toBeNull();
    expect(saved.fetching).toBe(false);
    expect(saved.dropsCompleted).toBe(1);
    expect(saved.waterPackets).toEqual(packets);
    saved.position = { x: mission.fire.x + 100, y: 55, z: mission.fire.z };
    saved.precisionAction = 'release';
    clearRelocatedObjectiveActions(saved, mission);
    expect(saved.precisionAction).toBeNull();
  });

  it('retains local actions already aligned with the new objective', () => {
    const saved = createSim(campaign, mission) as ExtendedSimState;
    saved.position = { ...mission.lake, y: 25 };
    saved.precisionAction = 'fetch';
    saved.fetching = true;
    clearRelocatedObjectiveActions(saved, mission);
    expect(saved.precisionAction).toBe('fetch');
    expect(saved.fetching).toBe(true);
  });
});
