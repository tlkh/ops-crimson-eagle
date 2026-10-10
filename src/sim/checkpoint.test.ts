import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { WORLD_REVISION } from '../worldRevision';
import { setTreeColliders } from './collision';
import { checkpointIntersectsWorld, createSim } from './index';

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
});
