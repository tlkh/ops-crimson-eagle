import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { shipRadomePlacements } from '../content/shipDetails';
import { checkpointIntersectsWorld, createSim } from './index';
import { shipToWorld } from './shipLanding';

describe('Kunisaki roof fitting clearance', () => {
  const campaign = campaigns.find(item => item.id === 'jp_ketapang_2026_09')!;

  for (const heading of [0, .73]) {
    it(`detects the new radome above the bridge without extending an invisible wall (heading ${heading})`, () => {
      const mission = { ...campaign.missions[0], shipHeading: heading };
      const state = createSim(campaign, mission);
      state.phase = 'transit';
      state.heading = heading;
      state.bucketAttached = false;
      const dome = shipRadomePlacements(campaign)[1];
      // The aft cabin reaches the forward radome, while the rotor discs and
      // cabin clear the old bridge roof and remain forward of the tall mast.
      state.position = { ...shipToWorld(mission, { x: dome.x, z: dome.z - 8 }), y: 10.5 };
      const saved = structuredClone(state);
      expect(checkpointIntersectsWorld(state, campaign, mission)).toBe(true);
      expect(state).toEqual(saved);

      state.position.y = 13;
      expect(checkpointIntersectsWorld(state, campaign, mission)).toBe(false);
      expect(checkpointIntersectsWorld(createSim(campaign, mission), campaign, mission)).toBe(false);
    });
  }
});
