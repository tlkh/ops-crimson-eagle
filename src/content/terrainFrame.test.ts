import { describe, expect, it } from 'vitest';
import { campaigns } from './index';
import type { Campaign } from '../types';
import { campaignTerrainAnchor, campaignTerrainAxisAnchor, campaignTerrainFrame } from './terrainFrame';

describe('campaign terrain frame', () => {
  it('uses the original campaign shore/lake anchor and ignores mission geometry', () => {
    for (const campaign of campaigns) {
      const mission = campaign.missions[0];
      const original = campaignTerrainFrame(campaign, mission);
      const changedMission = {
        ...mission,
        ship: { ...mission.ship, x: 4300, z: -2100 },
        shipHeading: 2,
        lake: { ...mission.lake, x: -2700, z: 5100 },
        fire: { ...mission.fire, x: 3900, z: 3600 },
        shore: mission.shore ? { ...mission.shore, x: 1800, z: -600 } : undefined,
      };
      const changedCampaign: Campaign = {
        ...campaign,
        missions: [changedMission, ...campaign.missions.slice(1)],
      };

      expect(campaignTerrainAxisAnchor(campaign)).toEqual(campaign.id === 'sg_fictional_2026_10'
        ? { x: 220, z: 1485 }
        : { x: 120, z: 400 });
      expect(campaignTerrainFrame(campaign)).toEqual(original);
      expect(campaignTerrainFrame(changedCampaign, changedMission)).toEqual(original);
      expect(original.origin).toEqual(campaignTerrainAnchor(campaign));
      const anchor = campaignTerrainAxisAnchor(campaign);
      expect(original.ux).toBeCloseTo(anchor.x / original.length);
      expect(original.uz).toBeCloseTo(anchor.z / original.length);
    }
  });
});
